import { canonicalUrl, reconcilePosts, upgradeArchiveTimes } from './thread-model.js';
import { applySyncPauseState } from './idle-reactivation.js';

export function createLiveSync({ inFlight, get, ensureArchive, now, fetchQueuedPage, persist, locked, db, POST_LIVE_REFRESH_MAX_AGE_MS, THREAD_IDLE_STOP_MS }) {
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
                    applySyncPauseState(members[id], { removed, verifiedIdle, successful, syncTimestamp });
                    await db.putMany({ cacheMembers: JSON.stringify(members) }, { lightweight: true });
                }
            });
        })();
        inFlight.set(id, run);
        try { return await run; } finally { inFlight.delete(id); }
    }
    return syncOne;
}
