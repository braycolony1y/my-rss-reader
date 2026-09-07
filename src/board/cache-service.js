import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { canonicalIdentity, canonicalUrl, reconcilePosts, upgradeArchiveTimes } from './thread-model.js';

export function createBoardCache({ env, fetchPage, writeJson, directory = './article_cache/threads', loadLegacy = async () => [], now = () => Date.now(), retentionMs = Number(process.env.CACHE_DISMISSAL_RETENTION_DAYS || 30) * 86400000 }) {
    retentionMs = Number.isFinite(retentionMs) && retentionMs > 0 ? retentionMs : 30 * 86400000;
    const db = env.RSS_DATA;
    let queue = Promise.resolve();
    const locked = fn => { const result = queue.then(fn); queue = result.catch(() => {}); return result; };
    const inFlight = new Map();
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
    const get = async (key, fallback) => await db.get(key, { type: 'json' }) || fallback;
    const put = (key, value) => db.put(key, JSON.stringify(value));
    const filename = id => path.join(directory, createHash('sha256').update(id).digest('hex') + '.json');
    const read = async id => { try { return JSON.parse(await fs.readFile(filename(id), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
    const persist = async record => { await fs.mkdir(directory, { recursive: true }); await writeJson(filename(record.thread_id), record); };
    const isCache = folder => String(folder).toLowerCase() === 'cache';
    const identity = article => { try { return canonicalIdentity(article); } catch { return null; } };

    async function ensureArchive(member) {
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
        const members = await reconcileMembership();
        for (const member of Object.values(members)) if (member.in_cache) await ensureArchive(member);
    }
    async function reconcileMembership() {
        return locked(async () => {
            const prefs = await get('userPreferences', {});
            const board = new Set((await get('boardStates', [])).map(identity));
            const members = await get('cacheMembers', {});
            const ledger = await get('cacheIdentityLedger', { initialized_at: now(), articles: {}, dismissals: {} });
            const present = new Set();
            const articlePool = [...await get('articles', []), ...await get('smartRawArticles', [])];
            for (const [link, folder] of Object.entries(prefs.boardFolderMappings || {})) {
                const id = identity(link);
                if (!id || !isCache(folder) || !board.has(id)) continue;
                present.add(id);
                members[id] ||= { thread_id: id, url: canonicalUrl(link), article: articlePool.find(a => identity(a) === id) || { link, title: link }, active_caching: true, auto_added: false };
                if (members[id].in_cache === false) members[id].active_caching = true;
                members[id].in_cache = true;
            }
            for (const [id, member] of Object.entries(members)) {
                if (member.in_cache !== false && !present.has(id)) {
                    member.in_cache = false;
                    member.active_caching = false;
                    if (member.auto_added) ledger.dismissals[id] = { last_seen_at: now(), expires_at: now() + retentionMs };
                }
            }
            for (const [id, dismissal] of Object.entries(ledger.dismissals)) if (dismissal.expires_at <= now()) delete ledger.dismissals[id];
            await db.putMany({ cacheMembers: JSON.stringify(members), cacheIdentityLedger: JSON.stringify(ledger) });
            return members;
        });
    }
    async function observe(articles) {
        const candidates = await locked(async () => {
            const ledger = await get('cacheIdentityLedger', null);
            if (!ledger) return [];
            const rules = await get('cacheAutoRules', []);
            const pending = [];
            for (const article of articles) {
                const id = identity(article); if (!id) continue;
                const known = ledger.articles[id];
                const dismissal = ledger.dismissals[id];
                if (dismissal && dismissal.expires_at > now()) { dismissal.last_seen_at = now(); dismissal.expires_at = now() + retentionMs; }
                else if (dismissal) delete ledger.dismissals[id];
                if (known) {
                    known.last_seen_at = now();
                    if (known.pending && !dismissal) pending.push({ article: known.pending, id, initialized_at: ledger.initialized_at });
                    continue;
                }
                ledger.articles[id] = { first_seen_at: now(), last_seen_at: now(), auto_added: false };
                const title = String(article.title || '').normalize('NFKC').toLowerCase();
                const match = rules.some(rule => rule.enabled && (!rule.source || rule.source === article.feedUrl)
                    && rule.keywords.some(word => title.includes(word.normalize('NFKC').toLowerCase())));
                if (match && !dismissal) { ledger.articles[id].pending = article; pending.push({ article, id, initialized_at: ledger.initialized_at }); }
            }
            for (const [id, dismissal] of Object.entries(ledger.dismissals)) if (dismissal.expires_at <= now()) delete ledger.dismissals[id];
            await put('cacheIdentityLedger', ledger);
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
                firstPage = await fetchPage(canonicalUrl(candidate.article), candidate.article.feedUrl || '');
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
                    members[candidate.id] = { thread_id: candidate.id, url, article: { ...candidate.article, link: url }, active_caching: true, in_cache: true, auto_added: true };
                    ledger.articles[candidate.id].auto_added = true;
                    delete ledger.articles[candidate.id].pending;
                    await db.putMany({ cacheMembers: JSON.stringify(members), cacheIdentityLedger: JSON.stringify(ledger), boardStates: JSON.stringify(board), userPreferences: JSON.stringify(prefs) });
                });
                await syncOne(candidate.id, firstPage);
            } catch (error) { console.warn('[AUTO CACHE]', error.message); }
        }
    }
    async function syncOne(id, initialPage = null) {
        if (inFlight.has(id)) return inFlight.get(id);
        const run = (async () => {
            await acquireSlot();
            const member = (await get('cacheMembers', {}))[id];
            if (!member?.in_cache || !member.active_caching) return;
            let record = await ensureArchive(member);
            let complete = true;
            let removed = false;
            const posts = new Map();
            try {
                const first = initialPage || await fetchPage(member.url, member.article.feedUrl || '');
                if (first.isDeletedSource || first.isDeletedThread || first.sourceDeleted) { removed = true; throw new Error('Thread removed from source'); }
                record.title = first.title || member.article.title;
                record.url = member.url;
                if (id.includes(':thread:') || first.threadSnapshot) {
                    const snapshot = first.threadSnapshot;
                    if (!snapshot?.complete || snapshot.currentPage !== 1 || !snapshot.posts.length) throw new Error('Page 1 lacks complete permanent post IDs');
                    const count = snapshot.pageCount;
                    for (const post of snapshot.posts) posts.set(post.post_id, post);
                    for (let page = 2; page <= count; page++) {
                        const current = (await get('cacheMembers', {}))[id];
                        if (!current?.active_caching || !current.in_cache) throw new Error('Caching paused');
                        try {
                            const result = await fetchPage(`${member.url.replace(/\/$/, '')}/page-${page}`, member.article.feedUrl || '');
                            const s = result.threadSnapshot;
                            if (!s?.complete || s.currentPage !== page || s.pageCount !== count || !s.posts.length) throw new Error(`Page ${page} is incomplete or pagination changed`);
                            for (const post of s.posts) {
                                if (posts.has(post.post_id)) {
                                    if (post.current_visible_number !== 1) { complete = false; record.sync_error = 'Posts shifted between pages during the scan'; }
                                } else posts.set(post.post_id, post);
                            }
                        } catch (e) { complete = false; record.sync_error = e.message; }
                    }
                    // Check pagination again: a shifting thread must never imply deletion.
                    const beforeVerify = (await get('cacheMembers', {}))[id];
                    if (!beforeVerify?.active_caching || !beforeVerify.in_cache) complete = false;
                    if (count > 1 && complete) {
                        const verify = (await fetchPage(member.url, member.article.feedUrl || '')).threadSnapshot;
                        if (!verify?.complete || verify.pageCount !== count || JSON.stringify(verify.posts.map(p => p.post_id)) !== JSON.stringify(snapshot.posts.map(p => p.post_id))) complete = false;
                    }
                } else {
                    if (!first.content || first.isDeletedSource) throw new Error('Article content unavailable');
                    posts.set('article', { thread_id: id, post_id: 'article', author_id: null, author_name: first.author || '', current_content: first.content,
                        created_at: member.article.pubDate || null, edited_at: first.edited_at || null, current_page: 1, current_position: 1, current_visible_number: null, permalink: member.url });
                }
            } catch (e) { complete = false; record.sync_error = e.message; }
            const current = (await get('cacheMembers', {}))[id];
            if (!current?.active_caching || !current.in_cache) complete = false;
            reconcilePosts(record, [...posts.values()], complete, new Date(now()).toISOString());
            record.active_caching = current?.active_caching === true;
            if (complete) { record.sync_error = null; record.source_removed = false; record.removed_at = null; }
            if (removed) { record.source_removed = true; record.removed_at ||= new Date(now()).toISOString(); record.sync_status = 'removed'; record.active_caching = false; }
            upgradeArchiveTimes(record);
            await persist(record);
            await locked(async () => {
                const members = await get('cacheMembers', {});
                if (members[id]) {
                    members[id].source_created_at = record.source_created_at;
                    members[id].cached_at = record.cached_at;
                    members[id].source_unavailable = record.source_removed === true;
                    members[id].source_removed = record.source_removed === true;
                    members[id].sync_status = record.sync_status;
                    members[id].last_successful_sync_at = record.last_successful_sync_at;
                    if (removed) members[id].active_caching = false;
                    await put('cacheMembers', members);
                }
            });
        })();
        inFlight.set(id, run);
        try { return await run; } finally { inFlight.delete(id); releaseSlot(); }
    }
    async function tick() {
        if (ticking) return ticking;
        ticking = (async () => {
        const ledger = await get('cacheIdentityLedger', null);
        const pending = Object.values(ledger?.articles || {}).map(entry => entry.pending).filter(Boolean);
        if (pending.length) await observe(pending);
        const members = await reconcileMembership();
        // Bounded concurrency; a running thread never overlaps its next minute.
        const ids = Object.keys(members).filter(id => members[id].in_cache && members[id].active_caching && !inFlight.has(id));
        const worker = async () => { while (ids.length) await syncOne(ids.shift()).catch(e => console.warn('[CACHE SYNC]', e.message)); };
        await Promise.all([worker(), worker()]);
        })();
        try { return await ticking; } finally { ticking = null; }
    }
    async function setFolder(article, folder) {
        const id = canonicalIdentity(article);
        if (folder !== null && (typeof folder !== 'string' || !folder.trim() || folder.length > 120)) throw new Error('Use a folder name of 1–120 characters');
        if (folder !== null) folder = isCache(folder.trim()) ? 'cache' : folder.trim();
        const result = await locked(async () => {
            const prefs = await get('userPreferences', {});
            const board = await get('boardStates', []);
            const members = await get('cacheMembers', {});
            const ledger = await get('cacheIdentityLedger', { initialized_at: now(), articles: {}, dismissals: {} });
            const url = board.find(link => identity(link) === id) || canonicalUrl(article);
            const nextBoard = board.filter(link => identity(link) !== id);
            prefs.boardFolderMappings ||= {};
            for (const key of Object.keys(prefs.boardFolderMappings)) if (identity(key) === id) delete prefs.boardFolderMappings[key];
            if (folder !== null) {
                nextBoard.push(url);
                prefs.boardFolderMappings[url] = folder;
                prefs.boardFolders = [...new Set([...(prefs.boardFolders || []), folder])];
            }
            const member = members[id];
            if (folder === 'cache') {
                members[id] = { ...member, thread_id: id, url, article: typeof article === 'string' ? { link: url, title: url } : { ...member?.article, ...article, link: url },
                    in_cache: true, active_caching: member?.in_cache ? member.active_caching : true, auto_added: member?.auto_added || false };
                delete ledger.dismissals[id];
            } else if (member?.in_cache) {
                member.in_cache = false; member.active_caching = false;
                if (member.auto_added) ledger.dismissals[id] = { last_seen_at: now(), expires_at: now() + retentionMs };
            }
            ledger.articles[id] ||= { first_seen_at: now(), last_seen_at: now(), auto_added: false };
            delete ledger.articles[id].pending;
            await db.putMany({ cacheMembers: JSON.stringify(members), cacheIdentityLedger: JSON.stringify(ledger), boardStates: JSON.stringify(nextBoard), userPreferences: JSON.stringify(prefs) });
            return { boardStates: nextBoard, userPreferences: prefs, cacheMember: members[id] || null };
        });
        if (folder === 'cache') void syncOne(id).catch(e => console.warn('[CACHE ADD]', e.message));
        return result;
    }
    async function setActive(url, active) {
        const id = canonicalIdentity(url);
        await locked(async () => {
            const members = await get('cacheMembers', {});
            if (!members[id]?.in_cache) throw new Error('Article is not in Cache');
            members[id].active_caching = active;
            await put('cacheMembers', members);
        });
        if (active) void syncOne(id).catch(e => console.warn('[CACHE RESUME]', e.message));
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
    return { initialize, observe, reconcileMembership, tick, syncOne, setActive, setFolder, saveRules,
        status: async () => ({ rules: await get('cacheAutoRules', []), members: await get('cacheMembers', {}) }),
        archive: async url => { const id = canonicalIdentity(url); const record = await read(id); if (record) upgradeArchiveTimes(record); return record ? { ...record, active_caching: (await get('cacheMembers', {}))[id]?.active_caching === true } : null; },
        managed: async url => Boolean((await get('cacheMembers', {}))[identity(url)]),
    };
}
