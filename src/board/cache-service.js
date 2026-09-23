import { archiveExpiry } from '../articles/retention.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { archivePage, renderArchive } from './presentation.js';
import { createHash, randomUUID } from 'node:crypto';
import { canonicalIdentity, canonicalUrl, reconcilePosts, upgradeArchiveTimes } from './thread-model.js';

export function createBoardCache({ env, fetchPage, writeJson, directory = './article_cache/threads', loadLegacy = async () => [], now = () => Date.now(), retentionMs = Number(process.env.CACHE_DISMISSAL_RETENTION_DAYS || 30) * 86400000 }) {
    retentionMs = Number.isFinite(retentionMs) && retentionMs > 0 ? retentionMs : 30 * 86400000;
    const db = env.RSS_DATA;
    // Board mutations still run one at a time, but foreground
    // interactions must not sit behind a large backlog of cache
    // maintenance jobs.
    let lockActive = false;
    let lockSequence = 0;
    const lockWaiters = [];

    const runNextLock = () => {
        if (lockActive || !lockWaiters.length) return;

        lockWaiters.sort(
            (a, b) =>
                b.priority - a.priority ||
                a.sequence - b.sequence
        );

        const entry = lockWaiters.shift();
        lockActive = true;

        const startedAt = Date.now();
        const waitedMs = startedAt - entry.queuedAt;

        const waitWarningMs =
            entry.priority >= 100 ? 500 : 5000;

        if (waitedMs >= waitWarningMs) {
            console.warn(
                `[BOARD LOCK] #${entry.sequence} ` +
                `${entry.label} waited ${waitedMs}ms`
            );
        }

        Promise.resolve()
            .then(entry.fn)
            .then(entry.resolve, entry.reject)
            .finally(() => {
                const heldMs = Date.now() - startedAt;

                const holdWarningMs =
                    entry.priority >= 100 ? 500 : 5000;

                if (heldMs >= holdWarningMs) {
                    console.warn(
                        `[BOARD LOCK] #${entry.sequence} ` +
                        `${entry.label} held ${heldMs}ms`
                    );
                }

                lockActive = false;
                queueMicrotask(runNextLock);
            });
    };

    const locked = (
        fn,
        {
            priority = 0,
            label = 'background'
        } = {}
    ) => new Promise((resolve, reject) => {
        lockWaiters.push({
            fn,
            resolve,
            reject,
            priority,
            label,
            sequence: ++lockSequence,
            queuedAt: Date.now()
        });

        runNextLock();
    });

    const foregroundLocked = (
        fn,
        label = 'foreground'
    ) => locked(
        fn,
        {
            priority: 100,
            label
        }
    );

    const inFlight = new Map();

    /*
     * Threads currently being read get the fast cache lane.
     *
     * The browser should touch the thread periodically. A TTL is used so a
     * crashed tab, sleeping laptop, lost connection, etc. cannot leave a
     * thread permanently marked as active.
     */
    /*
     * thread id -> Map(viewer id -> expiry timestamp)
     *
     * Different tabs/users can view the same thread simultaneously.
     * Closing one viewer must not clear another viewer's priority.
     */
    const activeViews = new Map();

    /*
     * Heartbeat is every 30s. Two minutes leaves enough room for ordinary
     * browser timer throttling while still recovering automatically from a
     * crashed/closed client.
     */
    const ACTIVE_VIEW_TTL_MS = 120 * 1000;
    const HOT_THREAD_MAX_AGE_MS = 24 * 60 * 60 * 1000;
    const POST_LIVE_REFRESH_MAX_AGE_MS = 60 * 60 * 1000;
    const THREAD_IDLE_STOP_MS = 24 * 60 * 60 * 1000;

    function viewThreadId(value) {
        if (!value) return null;

        const raw = String(value);

        if (/^[^:]+:thread:/.test(raw)) {
            return raw;
        }

        try {
            return canonicalIdentity(value);
        } catch {
            return null;
        }
    }

    function normalizeViewerId(value) {
        const viewerId = String(value || 'default').trim();

        return viewerId
            ? viewerId.slice(0, 120)
            : 'default';
    }

    function touchView(value, viewerId = 'default') {
        const id = viewThreadId(value);
        if (!id) return null;

        const viewer =
            normalizeViewerId(viewerId);

        let viewers =
            activeViews.get(id);

        if (!viewers) {
            viewers = new Map();
            activeViews.set(id, viewers);
        }

        viewers.set(
            viewer,
            now() + ACTIVE_VIEW_TTL_MS
        );

        return id;
    }

    function clearView(value, viewerId = 'default') {
        const id = viewThreadId(value);
        if (!id) return false;

        const viewers =
            activeViews.get(id);

        if (!viewers) return false;

        viewers.delete(
            normalizeViewerId(viewerId)
        );

        if (!viewers.size) {
            activeViews.delete(id);
        }

        return true;
    }

    function pruneActiveViews() {
        const currentTime = now();

        for (const [id, viewers] of activeViews) {
            for (const [viewerId, expiresAt] of viewers) {
                if (expiresAt <= currentTime) {
                    viewers.delete(viewerId);
                }
            }

            if (!viewers.size) {
                activeViews.delete(id);
            }
        }
    }

    function isActivelyViewed(id) {
        const viewers =
            activeViews.get(id);

        if (!viewers) {
            return false;
        }

        const currentTime = now();

        for (const [viewerId, expiresAt] of viewers) {
            if (expiresAt <= currentTime) {
                viewers.delete(viewerId);
            }
        }

        if (!viewers.size) {
            activeViews.delete(id);
            return false;
        }

        return true;
    }

    function memberSourceCreatedAt(member) {
        const candidates = [
            member?.last_verified_post_at,
            member?.source_created_at,
            member?.article?.pubDate
        ];

        for (const value of candidates) {
            const timestamp = Date.parse(value || '');

            if (Number.isFinite(timestamp)) {
                return timestamp;
            }
        }

        return null;
    }

    function isHotCacheMember(member) {
        const createdAt =
            memberSourceCreatedAt(member);

        if (!Number.isFinite(createdAt)) {
            return false;
        }

        const age = now() - createdAt;

        return (
            age >= 0 &&
            age <= HOT_THREAD_MAX_AGE_MS
        );
    }

    function lastSuccessfulSyncTime(member) {
        const timestamp = Date.parse(
            member?.last_successful_sync_at || ''
        );

        return Number.isFinite(timestamp)
            ? timestamp
            : 0;
    }

    let ticking = null;
    let activeSyncs = 0;
    const slotWaiters = [];
    const acquireSlot = async () => {
        if (activeSyncs >= 2) await new Promise(resolve => slotWaiters.push(resolve));
        else activeSyncs++;
    };
    const releaseSlot = () => {
        const next = slotWaiters.shift();
        if (next) next(); else activeSyncs--;
    };
    const fetchQueuedPage = async (...args) => {
        await acquireSlot();
        try { return await fetchPage(...args); } finally { releaseSlot(); }
    };
    const get = async (key, fallback) => await db.get(key, { type: 'json' }) || fallback;
    const put = (key, value) => db.put(key, JSON.stringify(value));
    const filename = id => path.join(directory, createHash('sha256').update(id).digest('hex') + '.json');
    const readRaw = async id => { try { return JSON.parse(await fs.readFile(filename(id), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
    const protectedIds = async () => new Set([
        ...await get('boardStates', []), ...await get('savedStates', [])
    ].map(value => canonicalIdentity(value)));
    function updateRetention(member, protectedArchive) {
        const before = JSON.stringify(member);
        member.retention_protected = protectedArchive;
        if (protectedArchive) member.left_cache_at = null;
        else member.left_cache_at ||= new Date(now()).toISOString();
        return before !== JSON.stringify(member);
    }
    const read = async id => {
        const member = (await get('cacheMembers', {}))[id];
        if (member?.archive_expired_at || archiveExpiry({ ...member, retention_protected: (await protectedIds()).has(id) }) <= now()) return null;
        return readRaw(id);
    };
    async function cleanup() {
        return locked(async () => {
            const members = await get('cacheMembers', {});
            const protectedArchives = await protectedIds();
            let changed = false;
            // Older archives may predate membership tracking. Give those copies
            // a recorded departure date instead of retaining orphan files forever.
            for (const name of await fs.readdir(directory).catch(error => { if (error.code === 'ENOENT') return []; throw error; })) {
                if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
                if (Object.keys(members).some(id => path.basename(filename(id)) === name)) continue;
                const record = JSON.parse(await fs.readFile(path.join(directory, name), 'utf8'));
                if (!record.thread_id || !record.url || path.basename(filename(record.thread_id)) !== name) continue;
                members[record.thread_id] = { thread_id: record.thread_id, url: record.url, article: { link: record.url, title: record.title },
                    in_cache: false, active_caching: false, left_cache_at: new Date(now()).toISOString(),
                    source_removed: record.source_removed === true, removed_at: record.removed_at || null };
                changed = true;
            }
            for (const [id, member] of Object.entries(members)) {
                if (updateRetention(member, protectedArchives.has(id))) changed = true;
                if (member.source_removed && !member.removed_at) {
                    const record = await readRaw(id);
                    member.removed_at = record?.removed_at || new Date(now()).toISOString(); changed = true;
                }
                if (archiveExpiry(member) > now() || inFlight.has(id)) continue;
                await fs.rm(filename(id), { force: true });
                for (const [key, cached] of renderedPages) if (key.startsWith(id + ':')) {
                    renderedBytes -= cached.bytes; renderedPages.delete(key);
                }
                if (!member.archive_expired_at) { member.archive_expired_at = new Date(now()).toISOString(); changed = true; }
                member.active_caching = false;
            }
            if (changed) await db.putMany({ cacheMembers: JSON.stringify(members) }, { lightweight: true });
        });
    }
    const persist = async record => { await fs.mkdir(directory, { recursive: true }); await writeJson(filename(record.thread_id), record); };
    // Rendered pages are immutable response data; file identity invalidates them
    // after both our atomic writes and external archive updates.
    const renderedPages = new Map();
    let renderedBytes = 0;
    async function articlePage(url) {
        const id = canonicalIdentity(url);
        const member = (await get('cacheMembers', {}))[id];
        if (!member?.in_cache || member.archive_expired_at || archiveExpiry({ ...member, retention_protected: (await protectedIds()).has(id) }) <= now()) return null;
        const file = filename(id);
        let stat;
        try { stat = await fs.stat(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
        const key = `${id}:${url}`;
        const revision = `${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
        const cached = renderedPages.get(key);
        if (cached?.revision === revision) {
            renderedPages.delete(key);
            renderedPages.set(key, cached);
            return { ...cached.payload, active_caching: member.active_caching === true };
        }
        const record = await read(id);
        if (!record || (!Object.keys(record.posts).length && !record.legacy_snapshots?.length)) return null;
        upgradeArchiveTimes(record);
        const page = archivePage(record, url);
        const payload = { url: page.url, title: record.title, content: renderArchive(page.record), cached: true,
            archive: true, sync_status: record.sync_status, last_successful_sync_at: record.last_successful_sync_at,
            sync_error: record.sync_error, pagination: page.pagination };
        const bytes = Buffer.byteLength(JSON.stringify(payload));
        if (cached) { renderedBytes -= cached.bytes; renderedPages.delete(key); }
        if (bytes <= 16 * 1024 * 1024) {
            renderedPages.set(key, { revision, payload, bytes });
            renderedBytes += bytes;
            while (renderedBytes > 16 * 1024 * 1024 || renderedPages.size > 100) {
                const oldest = renderedPages.keys().next().value;
                renderedBytes -= renderedPages.get(oldest).bytes;
                renderedPages.delete(oldest);
            }
        }
        return { ...payload, active_caching: member.active_caching === true };
    }
    const isCache = folder => String(folder).toLowerCase() === 'cache';
    const identity = article => { try { return canonicalIdentity(article); } catch { return null; } };

    async function ensureArchive(member) {
        if (member.archive_expired_at || archiveExpiry({ ...member, retention_protected: (await protectedIds()).has(member.thread_id) }) <= now()) return null;
        let record = await read(member.thread_id);
        if (record) {
            const before = JSON.stringify(record);
            upgradeArchiveTimes(record);
            if (before !== JSON.stringify(record)) await persist(record);
            return record;
        }
        record = { thread_id: member.thread_id, url: member.url, title: member.article.title, posts: {}, legacy_snapshots: [], first_seen_at: new Date(now()).toISOString() };
        for (const snapshot of await loadLegacy(member.url)) {
            reconcilePosts(record, snapshot.posts, false, snapshot.captured_at);
            if (snapshot.content) record.legacy_snapshots.push(snapshot);
            if (snapshot.title) record.title = snapshot.title;
        }
        await persist(record);
        return record;
    }
    async function initialize() {
        await locked(async () => {
            if (await get('cacheIdentityLedger', null)) return;
            const ledger = { initialized_at: now(), articles: {}, dismissals: {} };
            for (const key of ['articles', 'smartRawArticles']) for (const a of await get(key, [])) {
                const id = identity(a); if (id) ledger.articles[id] = { first_seen_at: now(), last_seen_at: now(), auto_added: false };
            }
            await put('cacheIdentityLedger', ledger);
        });
        await reconcileMembership();
        await cleanup();
        const members = await get('cacheMembers', {});
        for (const member of Object.values(members)) if (member.in_cache) await ensureArchive(member);
    }
    async function reconcileMembership() {
        return locked(async () => {
            const prefs = await get('userPreferences', {});
            const board = new Set((await get('boardStates', [])).map(identity));
            const members = await get('cacheMembers', {});
            const sharedLedger = await db.get(
                'cacheIdentityLedger',
                { type: 'json', shared: true }
            ) || { initialized_at: now(), articles: {}, dismissals: {} };

            let ledger = sharedLedger;
            let ledgerChanged = false;

            const mutableLedger = () => {
                if (!ledgerChanged) {
                    ledger = structuredClone(sharedLedger);
                    ledgerChanged = true;
                }
                return ledger;
            };

            // A stale preference snapshot is not an explicit Cache dismissal.
            // Restore missing mappings for members that are still pinned; explicit
            // moves/removals update membership through setFolder.
            prefs.boardFolderMappings ||= {};
            const mapped = new Set(Object.keys(prefs.boardFolderMappings).map(identity));
            for (const [id, member] of Object.entries(members)) {
                if (member.in_cache && board.has(id) && !mapped.has(id)) {
                    prefs.boardFolderMappings[member.url] = 'cache';
                    prefs.boardFolders = [...new Set([...(prefs.boardFolders || []), 'cache'])];
                }
            }
            const present = new Set();
            const articlePool = [...await get('articles', []), ...await get('smartRawArticles', [])];
            for (const [link, folder] of Object.entries(prefs.boardFolderMappings || {})) {
                const id = identity(link);
                if (!id || !isCache(folder) || !board.has(id)) continue;
                present.add(id);
                members[id] ||= { thread_id: id, url: canonicalUrl(link), article: articlePool.find(a => identity(a) === id) || { link, title: link }, active_caching: true, auto_added: false };
                if (members[id].in_cache === false) members[id].active_caching = true;
                if (members[id].in_cache === false) { members[id].left_cache_at = null; members[id].archive_expired_at = null; }
                members[id].in_cache = true;
            }
            for (const [id, member] of Object.entries(members)) {
                if (member.in_cache !== false && !present.has(id)) {
                    member.in_cache = false;
                    member.left_cache_at ||= new Date(now()).toISOString();
                    member.active_caching = false;
                    if (member.auto_added) {
                        mutableLedger().dismissals[id] = {
                            last_seen_at: now(),
                            expires_at: now() + retentionMs
                        };
                    }
                }
            }
            const protectedArchives = await protectedIds();
            for (const [id, member] of Object.entries(members)) updateRetention(member, protectedArchives.has(id));
            for (const [id, dismissal] of Object.entries(ledger.dismissals || {})) {
                if (dismissal.expires_at <= now()) {
                    delete mutableLedger().dismissals[id];
                }
            }

            const writes = {
                cacheMembers: JSON.stringify(members),
                userPreferences: JSON.stringify(prefs)
            };

            if (ledgerChanged) {
                writes.cacheIdentityLedger = JSON.stringify(ledger);
            }

            await db.putMany(writes);
            return members;
        });
    }
    async function observe(articles) {
        const candidates = await locked(async () => {
            let ledger = await db.get('cacheIdentityLedger', { type: 'json', shared: true });
            if (!ledger) return [];
            let changed = false;
            const mutableLedger = () => {
                if (!changed) {
                    ledger = { ...ledger, articles: { ...ledger.articles }, dismissals: { ...ledger.dismissals } };
                    changed = true;
                }
                return ledger;
            };
            const rules = await get('cacheAutoRules', []);
            const pending = [];
            for (const article of articles) {
                const id = identity(article); if (!id) continue;
                const known = ledger.articles[id];
                const dismissal = ledger.dismissals[id];
                if (dismissal && dismissal.expires_at > now()) {
                    mutableLedger().dismissals[id] = { ...dismissal, last_seen_at: now(), expires_at: now() + retentionMs };
                }
                else if (dismissal) delete mutableLedger().dismissals[id];
                if (known) {
                    // These entries remember identities permanently, not feed
                    // activity. Only dismissal timestamps drive expiry. Rewriting
                    // every known identity makes each feed copy the entire ledger.
                    if (known.pending && !dismissal) pending.push({ article: known.pending, id, initialized_at: ledger.initialized_at });
                    continue;
                }
                mutableLedger().articles[id] = { first_seen_at: now(), last_seen_at: now(), auto_added: false };
                const title = String(article.title || '').normalize('NFKC').toLowerCase();
                const match = rules.some(rule => rule.enabled && (!rule.source || rule.source === article.feedUrl)
                    && rule.keywords.some(word => title.includes(word.normalize('NFKC').toLowerCase())));
                if (match && !dismissal) { ledger.articles[id].pending = article; pending.push({ article, id, initialized_at: ledger.initialized_at }); }
            }
            for (const [id, dismissal] of Object.entries(ledger.dismissals)) if (dismissal.expires_at <= now()) delete mutableLedger().dismissals[id];
            if (changed) await put('cacheIdentityLedger', ledger);
            return pending;
        });
        for (const candidate of candidates) {
            let firstPage;
            try {
                const rules = await get('cacheAutoRules', []);
                const title = String(candidate.article.title || '').normalize('NFKC').toLowerCase();
                if (!rules.some(r => r.enabled && (!r.source || r.source === candidate.article.feedUrl) && r.keywords.some(k => title.includes(k.normalize('NFKC').toLowerCase())))) {
                    await locked(async () => { const ledger = await get('cacheIdentityLedger', null); delete ledger.articles[candidate.id].pending; await put('cacheIdentityLedger', ledger); });
                    continue;
                }
                firstPage = await fetchQueuedPage(canonicalUrl(candidate.article), candidate.article.feedUrl || '');
                // A bumped thread's RSS date is activity, not its birth date.
                const created = candidate.id.includes(':thread:')
                    ? firstPage.threadSnapshot?.posts.find(p => p.current_visible_number === 1 || p.current_position === 1)?.created_at
                    : candidate.article.createDate || candidate.article.pubDate;
                if (!created || !Number.isFinite(new Date(created).getTime()) || new Date(created).getTime() < candidate.initialized_at) {
                    await locked(async () => { const ledger = await get('cacheIdentityLedger', null); delete ledger.articles[candidate.id].pending; await put('cacheIdentityLedger', ledger); });
                    continue;
                }
                await locked(async () => {
                    const members = await get('cacheMembers', {});
                    const ledger = await get('cacheIdentityLedger', null);
                    if (ledger.dismissals[candidate.id] || members[candidate.id]?.in_cache) {
                        delete ledger.articles[candidate.id].pending;
                        await put('cacheIdentityLedger', ledger);
                        return;
                    }
                    const prefs = await get('userPreferences', {});
                    const board = await get('boardStates', []);
                    const url = board.find(link => identity(link) === candidate.id) || canonicalUrl(candidate.article);
                    if (!board.some(link => identity(link) === candidate.id)) board.push(url);
                    prefs.boardFolders = [...new Set([...(prefs.boardFolders || []), 'cache'])];
                    prefs.boardFolderMappings ||= {};
                    prefs.boardFolderMappings[url] = 'cache';
                    members[candidate.id] = { thread_id: candidate.id, url, article: { ...candidate.article, link: url }, active_caching: true, in_cache: true, left_cache_at: null, archive_expired_at: null, auto_added: true };
                    ledger.articles[candidate.id].auto_added = true;
                    delete ledger.articles[candidate.id].pending;
                    await db.putMany(
                        {
                            cacheMembers: JSON.stringify(members),
                            cacheIdentityLedger: JSON.stringify(ledger),
                            boardStates: JSON.stringify(board),
                            userPreferences: JSON.stringify(prefs)
                        },
                        { lightweight: true }
                    );
                });
                await syncOne(candidate.id, firstPage);
            } catch (error) { console.warn('[AUTO CACHE]', error.message); }
        }
    }
    async function syncOne(id, initialPage = null) {
        if (inFlight.has(id)) return inFlight.get(id);
        const run = (async () => {
            const member = (await get('cacheMembers', {}))[id];
            if (!member?.in_cache || !member.active_caching) return;
            let record = await ensureArchive(member);
            if (!record) return;

            let successful = true;
            let removed = false;
            let verifiedIdle = false;
            let latestVerifiedPost = null;
            let verifiedPageCount = null;
            const posts = new Map();
            const fetchedPages = new Set();
            const syncTimestamp = new Date(now()).toISOString();
            const freezeBefore = now() - POST_LIVE_REFRESH_MAX_AGE_MS;

            try {
                const sourceUrl = canonicalUrl(member.url);
                const first = initialPage || await fetchQueuedPage(sourceUrl, member.article.feedUrl || '');
                if (first.isDeletedSource || first.isDeletedThread || first.sourceDeleted) {
                    removed = true;
                    throw new Error('Thread removed from source');
                }
                record.title = first.title || member.article.title;
                record.url = member.url;

                if (id.includes(':thread:') || first.threadSnapshot) {
                    const firstSnapshot = first.threadSnapshot;
                    if (!firstSnapshot?.complete || firstSnapshot.currentPage !== 1 || !firstSnapshot.posts.length) {
                        throw new Error('Page 1 lacks complete permanent post IDs');
                    }

                    const pageCount = Math.max(1, Number(firstSnapshot.pageCount) || 1);
                    verifiedPageCount = pageCount;
                    fetchedPages.add(1);
                    for (const post of firstSnapshot.posts) posts.set(String(post.post_id), post);

                    const existing = Object.values(record.posts || {}).filter(post => /^\d+$/.test(String(post.post_id)));
                    const cachedMaxPage = existing.reduce((max, post) => Math.max(max, Number(post.current_page) || 1), 1);
                    const recentPages = existing
                        .filter(post => {
                            const created = Date.parse(post.source_created_at || post.created_at || '');
                            return Number.isFinite(created) && created > freezeBefore;
                        })
                        .map(post => Number(post.current_page) || 1);

                    // Do not rescan immutable historical pages. Keep one overlap
                    // page before the live frontier so deletions/pagination shifts
                    // can move surviving permanent post IDs without losing context.
                    let startPage;
                    if (!existing.length) startPage = 1;
                    else if (recentPages.length) startPage = Math.max(1, Math.min(...recentPages) - 1);
                    else startPage = Math.max(1, cachedMaxPage - 1);
                    startPage = Math.min(startPage, pageCount);

                    const fetchFrom = Math.max(2, startPage);
                    let lastSnapshot = pageCount === 1 ? firstSnapshot : null;
                    for (let page = fetchFrom; page <= pageCount; page++) {
                        const current = (await get('cacheMembers', {}))[id];
                        if (!current?.active_caching || !current.in_cache) throw new Error('Caching paused');
                        try {
                            const result = await fetchQueuedPage(`${sourceUrl.replace(/\/$/, '')}/page-${page}`, member.article.feedUrl || '');
                            const snapshot = result.threadSnapshot;
                            if (!snapshot?.complete || snapshot.currentPage !== page || !snapshot.posts.length) {
                                throw new Error(`Page ${page} is incomplete`);
                            }
                            if (Number(snapshot.pageCount) !== pageCount) {
                                successful = false;
                                record.sync_error = 'Pagination changed during the live-tail scan';
                            }
                            fetchedPages.add(page);
                            for (const post of snapshot.posts) posts.set(String(post.post_id), post);
                            if (page === pageCount) lastSnapshot = snapshot;
                        } catch (error) {
                            successful = false;
                            record.sync_error = error.message;
                        }
                    }

                    // If startPage was >1 and pageCount collapsed below it, the
                    // first page is still authoritative for a one-page thread.
                    if (pageCount === 1) lastSnapshot = firstSnapshot;

                    if (lastSnapshot?.complete && Number(lastSnapshot.currentPage) === pageCount && Number(lastSnapshot.pageCount) === pageCount) {
                        const tailPosts = [...lastSnapshot.posts].sort((a, b) => (Number(a.current_position) || 0) - (Number(b.current_position) || 0));
                        latestVerifiedPost = tailPosts.at(-1) || null;
                        const latestAt = Date.parse(latestVerifiedPost?.source_created_at || latestVerifiedPost?.created_at || '');
                        if (Number.isFinite(latestAt) && now() - latestAt > THREAD_IDLE_STOP_MS) {
                            verifiedIdle = true;
                        }
                    } else {
                        successful = false;
                    }

                    const scannedAllPages = startPage <= 1 && fetchedPages.size >= pageCount;
                    reconcilePosts(record, [...posts.values()], scannedAllPages && successful, syncTimestamp, {
                        freezeBefore,
                        markMissingRemoved: scannedAllPages && successful,
                        successful
                    });
                } else {
                    if (!first.content || first.isDeletedSource) throw new Error('Article content unavailable');
                    posts.set('article', {
                        thread_id: id,
                        post_id: 'article',
                        author_id: null,
                        author_name: first.author || '',
                        current_content: first.content,
                        created_at: member.article.pubDate || null,
                        edited_at: first.edited_at || null,
                        current_page: 1,
                        current_position: 1,
                        current_visible_number: null,
                        permalink: member.url
                    });
                    reconcilePosts(record, [...posts.values()], true, syncTimestamp, { successful: true });
                }
            } catch (error) {
                successful = false;
                record.sync_error = error.message;
                if (posts.size) {
                    reconcilePosts(record, [...posts.values()], false, syncTimestamp, {
                        freezeBefore,
                        markMissingRemoved: false,
                        successful: false
                    });
                } else {
                    record.sync_status = 'incomplete';
                }
            }

            const current = (await get('cacheMembers', {}))[id];
            if (!current?.in_cache) successful = false;
            record.active_caching = current?.active_caching === true;
            if (successful) {
                record.sync_error = null;
                record.source_removed = false;
                record.removed_at = null;
            }
            if (removed) {
                record.source_removed = true;
                record.removed_at ||= new Date(now()).toISOString();
                record.sync_status = 'removed';
                record.active_caching = false;
            }
            if (latestVerifiedPost) {
                record.last_verified_post_id = String(latestVerifiedPost.post_id || '');
                record.last_verified_post_at = latestVerifiedPost.source_created_at || latestVerifiedPost.created_at || null;
                record.last_live_verification_at = syncTimestamp;
                record.live_page_count = verifiedPageCount;
            }
            if (verifiedIdle && successful && !removed) {
                record.active_caching = false;
                record.stop_reason = 'verified_idle_24h';
                record.stopped_at = syncTimestamp;
            } else if (successful && !removed) {
                record.stop_reason = null;
                record.stopped_at = null;
            }

            upgradeArchiveTimes(record);
            await persist(record);
            await locked(async () => {
                const members = await get('cacheMembers', {});
                if (members[id]) {
                    members[id].source_created_at = record.source_created_at;
                    members[id].cached_at = record.cached_at;
                    members[id].source_unavailable = record.source_removed === true;
                    members[id].source_removed = record.source_removed === true;
                    members[id].removed_at = record.removed_at || null;
                    members[id].sync_status = record.sync_status;
                    members[id].last_successful_sync_at = record.last_successful_sync_at;
                    members[id].last_verified_post_id = record.last_verified_post_id || members[id].last_verified_post_id || null;
                    members[id].last_verified_post_at = record.last_verified_post_at || members[id].last_verified_post_at || null;
                    members[id].last_live_verification_at = record.last_live_verification_at || members[id].last_live_verification_at || null;
                    members[id].live_page_count = record.live_page_count || members[id].live_page_count || null;
                    if (removed) {
                        members[id].active_caching = false;
                        members[id].stop_reason = 'source_removed';
                    } else if (verifiedIdle && successful) {
                        members[id].active_caching = false;
                        members[id].stop_reason = 'verified_idle_24h';
                        members[id].stopped_at = syncTimestamp;
                    } else if (successful) {
                        members[id].stop_reason = null;
                        members[id].stopped_at = null;
                    }
                    await db.putMany({ cacheMembers: JSON.stringify(members) }, { lightweight: true });
                }
            });
        })();
        inFlight.set(id, run);
        try { return await run; } finally { inFlight.delete(id); }
    }
    async function tick() {
        /*
         * One maintenance cycle at a time.
         *
         * Unlike the old implementation, a cycle no longer walks every cached
         * thread. It schedules at most two thread scans:
         *
         *   HOT lane:
         *     1. currently viewed threads
         *     2. threads whose first post/source creation is <= 24h old
         *     3. background fallback
         *
         *   BACKGROUND lane:
         *     1. older cached threads
         *     2. hot/viewed fallback when no background work exists
         *
         * Within each class, the least recently successfully synced thread
         * goes first.
         */
        if (ticking) return ticking;

        const run = (async () => {
            const ledger = await db.get(
                'cacheIdentityLedger',
                { type: 'json', shared: true }
            );

            const pending = Object.values(
                ledger?.articles || {}
            )
                .map(entry => entry.pending)
                .filter(Boolean);

            if (pending.length) {
                await observe(pending);
            }

            const members =
                await reconcileMembership();

            pruneActiveViews();

            const compareOldestFirst =
                (left, right) =>
                    lastSuccessfulSyncTime(
                        members[left]
                    ) -
                    lastSuccessfulSyncTime(
                        members[right]
                    ) ||
                    left.localeCompare(right);

            const eligible =
                Object.keys(members)
                    .filter(id =>
                        members[id]?.in_cache &&
                        members[id]?.active_caching &&
                        !inFlight.has(id)
                    );

            const viewed = eligible
                .filter(id =>
                    isActivelyViewed(id)
                )
                .sort(compareOldestFirst);

            const viewedSet =
                new Set(viewed);

            const hot = eligible
                .filter(id =>
                    !viewedSet.has(id) &&
                    isHotCacheMember(
                        members[id]
                    )
                )
                .sort(compareOldestFirst);

            const hotSet =
                new Set([
                    ...viewed,
                    ...hot
                ]);

            const background = eligible
                .filter(id =>
                    !hotSet.has(id)
                )
                .sort(compareOldestFirst);

            /*
             * Lane 1:
             * actively viewed > recent <=24h > background fallback
             */
            const hotLaneId =
                viewed[0] ||
                hot[0] ||
                background[0] ||
                null;

            /*
             * Lane 2 normally belongs to old/background cache work.
             *
             * If there is no background work, don't leave capacity idle:
             * help another viewed/hot thread.
             */
            let backgroundLaneId =
                background.find(
                    id => id !== hotLaneId
                ) ||
                viewed.find(
                    id => id !== hotLaneId
                ) ||
                hot.find(
                    id => id !== hotLaneId
                ) ||
                null;

            if (
                backgroundLaneId ===
                hotLaneId
            ) {
                backgroundLaneId = null;
            }

            console.info(
                '[CACHE TICK]',
                JSON.stringify({
                    eligible:
                        eligible.length,
                    viewed:
                        viewed.length,
                    hot:
                        hot.length,
                    background:
                        background.length,
                    hotLane:
                        hotLaneId,
                    backgroundLane:
                        backgroundLaneId
                })
            );

            const jobs = [];

            if (hotLaneId) {
                jobs.push(
                    syncOne(hotLaneId)
                        .catch(error =>
                            console.warn(
                                '[CACHE HOT]',
                                hotLaneId,
                                error.message
                            )
                        )
                );
            }

            if (backgroundLaneId) {
                jobs.push(
                    syncOne(
                        backgroundLaneId
                    ).catch(error =>
                        console.warn(
                            '[CACHE BACKGROUND]',
                            backgroundLaneId,
                            error.message
                        )
                    )
                );
            }

            // Only scheduling needs the cycle lock. A long thread must not
            // prevent the next tick from using capacity freed by another scan.
            // inFlight and the shared page queue still prevent overlap.
            if (ticking === run) ticking = null;
            if (jobs.length) {
                await Promise.all(jobs);
            }
        })();

        ticking = run;

        try {
            return await run;
        } finally {
            if (ticking === run) {
                ticking = null;
            }
        }
    }

    async function setFolder(article, folder, { compact = false } = {}) {
        const id = canonicalIdentity(article);
        if (folder !== null && (typeof folder !== 'string' || !folder.trim() || folder.length > 120)) throw new Error('Use a folder name of 1–120 characters');
        if (folder !== null) folder = isCache(folder.trim()) ? 'cache' : folder.trim();
        let startSync = false;
        const result = await foregroundLocked(
            async () => {
            const prefs = await get('userPreferences', {});
            const board = await get('boardStates', []);
            const members = await get('cacheMembers', {});

            const url = board.find(link => identity(link) === id) || canonicalUrl(article);
            const member = members[id];
            const currentFolder = Object.entries(prefs.boardFolderMappings || {}).find(([link]) => identity(link) === id)?.[1];
            const response = () => compact ? { thread_id: id, url, folder, cacheMember: members[id] ? { ...members[id], article: undefined } : null }
                : { boardStates: board, userPreferences: prefs, cacheMember: members[id] || null };
            if (currentFolder === folder && board.some(link => identity(link) === id) && (folder !== 'cache' || member?.in_cache)) return response();
            if (folder === null && !board.some(link => identity(link) === id) && !currentFolder && !member?.in_cache) return response();
            const writes = {};
            const wasPinned = board.some(link => identity(link) === id);
            if (folder === null) {
                for (let i = board.length - 1; i >= 0; i--) if (identity(board[i]) === id) board.splice(i, 1);
            } else if (!wasPinned) board.push(url);
            if (folder === null || !wasPinned) writes.boardStates = JSON.stringify(board);
            prefs.boardFolderMappings ||= {};
            for (const key of Object.keys(prefs.boardFolderMappings)) if (identity(key) === id) delete prefs.boardFolderMappings[key];
            if (folder !== null) {
                prefs.boardFolderMappings[url] = folder;
                prefs.boardFolders = [...new Set([...(prefs.boardFolders || []), folder])];
            }
            writes.userPreferences = JSON.stringify(prefs);
            if (folder === 'cache') {
                members[id] = { ...member, thread_id: id, url, article: typeof article === 'string' ? member?.article || { link: url, title: url } : { ...member?.article, ...article, link: url },
                    in_cache: true, left_cache_at: null, archive_expired_at: null, active_caching: member?.in_cache ? member.active_caching : true, auto_added: member?.auto_added || false };
                startSync = !member?.in_cache;
                writes.cacheMembers = JSON.stringify(members);
            } else if (member?.in_cache) {
                member.in_cache = false; member.active_caching = false; member.left_cache_at = new Date(now()).toISOString();
                writes.cacheMembers = JSON.stringify(members);
            }
            if (members[id]) {
                const saved = new Set((await get('savedStates', [])).map(identity));
                updateRetention(members[id], folder !== null || saved.has(id));
                writes.cacheMembers = JSON.stringify(members);
            }
            // Inspect the discovery ledger without copying its megabytes for a
            // normal folder move. Only write it when discovery/dismissal changes.
            const knownLedger = await db.get('cacheIdentityLedger', { type: 'json', shared: true });

            if (!knownLedger?.articles[id] || knownLedger.articles[id].pending ||
                (folder === 'cache' && knownLedger.dismissals[id]) || (folder !== 'cache' && member?.auto_added && writes.cacheMembers)) {
                const ledger = structuredClone(knownLedger || { initialized_at: now(), articles: {}, dismissals: {} });
                ledger.articles[id] ||= { first_seen_at: now(), last_seen_at: now(), auto_added: false };
                delete ledger.articles[id].pending;
                if (folder === 'cache') delete ledger.dismissals[id];
                else if (member?.auto_added && writes.cacheMembers) ledger.dismissals[id] = { last_seen_at: now(), expires_at: now() + retentionMs };
                writes.cacheIdentityLedger = JSON.stringify(ledger);
            }

            await db.putMany(writes, { lightweight: true });

            return response();
        },
        'setFolder'
        );


        if (startSync) {
            setImmediate(() =>
                void syncOne(id).catch(
                    e => console.warn('[CACHE ADD]', e.message)
                )
            );
        }

        return result;
    }
    async function setActive(url, active) {
        const id = canonicalIdentity(url);
        await locked(async () => {
            const members = await get('cacheMembers', {});
            if (!members[id]?.in_cache) throw new Error('Article is not in Cache');
            members[id].active_caching = active;
            if (active) {
                members[id].stop_reason = null;
                members[id].stopped_at = null;
                members[id].reactivated_at = new Date(now()).toISOString();
            } else {
                members[id].stop_reason = 'manual_pause';
                members[id].stopped_at = new Date(now()).toISOString();
            }
            await put('cacheMembers', members);
        });
        if (active) void syncOne(id).catch(e => console.warn('[CACHE RESUME]', e.message));
    }
    async function updatePreference(key, value) {
        // Share the same read-modify-write lock as auto-add and folder changes.
        return locked(async () => {
            const prefs = await get('userPreferences', {});
            if (key === 'boardFolderMappings') {
                if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Folder mappings must be an object');
                const mappings = { ...(prefs.boardFolderMappings || {}) };
                const known = new Set(Object.keys(mappings).map(identity));
                // Older clients send their entire local snapshot. Omission or a
                // stale value cannot undo a newer server-side assignment.
                for (const [url, folder] of Object.entries(value)) {
                    const id = identity(url);
                    if (id && !known.has(id) && typeof folder === 'string' && folder.trim()) {
                        mappings[url] = isCache(folder) ? 'cache' : folder;
                        known.add(id);
                    }
                }
                prefs[key] = mappings;
            } else {
                prefs[key] = value;
            }
            await put('userPreferences', prefs);
            return prefs;
        });
    }
    async function saveRules(rules) {
        if (!Array.isArray(rules) || rules.length > 100) throw new Error('Use up to 100 rules');
        const cleaned = rules.map(r => {
            if (!Array.isArray(r.keywords) || r.keywords.length > 100) throw new Error('Use up to 100 keywords per rule');
            const keywords = [...new Set(r.keywords.map(k => String(k).normalize('NFKC').toLowerCase().trim()).filter(Boolean))];
            if (!keywords.length || keywords.some(k => k.length > 200)) throw new Error('Each rule needs a keyword or phrase (up to 200 characters)');
            return { id: typeof r.id === 'string' ? r.id : randomUUID(), keywords, source: String(r.source || ''), enabled: r.enabled !== false };
        });
        await locked(() => put('cacheAutoRules', cleaned));
        return cleaned;
    }
    return { initialize, cleanup, observe, reconcileMembership, tick, syncOne, touchView, clearView, setActive, setFolder, saveRules, updatePreference,
        status: async () => ({ rules: await get('cacheAutoRules', []), members: await get('cacheMembers', {}) }),
        articlePage,
        archive: async url => { const id = canonicalIdentity(url); const record = await read(id); if (record) upgradeArchiveTimes(record); return record ? { ...record, active_caching: (await get('cacheMembers', {}))[id]?.active_caching === true } : null; },
        managed: async url => (await get('cacheMembers', {}))[identity(url)]?.in_cache === true,
    };
}
