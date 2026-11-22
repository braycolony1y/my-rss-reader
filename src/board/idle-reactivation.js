import { canonicalIdentity, canonicalUrl } from './thread-model.js';
import { mapWithConcurrency } from '../utils/article-utils.js';
import { workloadConcurrency, cpuCapacity } from '../runtime/concurrency-limiter.js';

const DAY = 86400000;
const CHECK_COOLDOWN = 5 * 60000;
const idle = member => member?.in_cache && !member.active_caching && member.stop_reason === 'verified_idle_24h';

// Preserve an explicit pause/removal that arrived while a scan was fetching.
export function applySyncPauseState(member, { removed, verifiedIdle, successful, syncTimestamp }) {
    if (!member.in_cache || member.stop_reason === 'manual_pause') return;
    if (removed) {
        member.active_caching = false;
        member.stop_reason = 'source_removed';
    } else if (verifiedIdle && successful) {
        member.active_caching = false;
        member.stop_reason = 'verified_idle_24h';
        member.stopped_at = syncTimestamp;
    } else if (successful) {
        member.stop_reason = null;
        member.stopped_at = null;
    }
}

export function createIdleReactivation({ get, put, locked, now, fetchQueuedPage, syncOne }) {
    const pending = new Map();
    async function probe(id) {
        const member = await locked(async () => {
            const members = await get('cacheMembers', {});
            const current = members[id];
            if (!idle(current)) return null;
            const checked = Date.parse(current.idle_checked_at || '');
            if (Number.isFinite(checked) && now() - checked < CHECK_COOLDOWN) return null;
            current.idle_checked_at = new Date(now()).toISOString();
            await put('cacheMembers', members);
            return current;
        });
        if (!member) return;
        try {
            const url = canonicalUrl(member.url);
            const first = await fetchQueuedPage(url, member.article?.feedUrl || '');
            const valid = (result, page, count) => !result.sourceDeleted && !result.isDeletedThread && !result.isDeletedSource
                && result.threadSnapshot?.complete && result.threadSnapshot.currentPage === page
                && Number(result.threadSnapshot.pageCount) === count && result.threadSnapshot.posts?.length;
            const count = Number(first.threadSnapshot?.pageCount);
            if (!Number.isInteger(count) || count < 1 || !valid(first, 1, count)) return;
            const tail = count === 1 ? first : await fetchQueuedPage(`${url.replace(/\/$/, '')}/page-${count}`, member.article?.feedUrl || '');
            if (!valid(tail, count, count)) return;
            const latest = [...tail.threadSnapshot.posts].sort((a, b) => Number(a.current_position) - Number(b.current_position)).at(-1);
            const timestamp = Date.parse(latest?.source_created_at || latest?.created_at || '');
            const previous = Date.parse(member.last_verified_post_at || '');
            if (!latest?.post_id || !Number.isFinite(timestamp) || timestamp > now() || now() - timestamp > DAY
                || (Number.isFinite(previous) && timestamp <= previous)) return;
            const resumed = await locked(async () => {
                const members = await get('cacheMembers', {});
                const current = members[id];
                // A user may have paused or removed it during the network check.
                if (!idle(current) || current.stopped_at !== member.stopped_at) return false;
                current.active_caching = true;
                current.stop_reason = null;
                current.stopped_at = null;
                current.reactivated_at = new Date(now()).toISOString();
                await put('cacheMembers', members);
                return true;
            });
            if (resumed) await syncOne(id, first);
        } catch (error) {
            console.warn('[CACHE IDLE CHECK]', id, error.message);
        }
    }
    function check(id) {
        if (pending.has(id)) return pending.get(id);
        const run = probe(id).finally(() => pending.delete(id));
        pending.set(id, run);
        return run;
    }
    async function observe(articles) {
        const candidates = await locked(async () => {
            const members = await get('cacheMembers', {});
            const groups = new Map();
            for (const article of articles) {
                const source = article.feedUrl || '';
                if (!groups.has(source)) groups.set(source, new Map());
                try {
                    const group = groups.get(source);
                    const id = canonicalIdentity(article);
                    if (!group.has(id)) group.set(id, { date: article.pubDate || '', rank: group.size });
                } catch { /* Ignore invalid feed links. */ }
            }
            let changed = false;
            const ids = [];
            for (const [id, member] of Object.entries(members)) {
                if (!idle(member)) continue;
                const group = groups.get(member.article?.feedUrl || '');
                if (!group) continue;
                const signal = group.get(id) || { absent: true };
                const before = member.idle_feed_signal;
                const activity = !signal.absent && (!before || before.absent || before.date !== signal.date || signal.rank < before.rank);
                // Do not consume an activity hint while throttled: the next
                // ingestion must still be able to verify it after cooldown.
                const checked = Date.parse(member.idle_checked_at || '');
                if (activity && Number.isFinite(checked) && now() - checked < CHECK_COOLDOWN) continue;
                if (activity) ids.push(id);
                if (JSON.stringify(before) !== JSON.stringify(signal)) {
                    member.idle_feed_signal = signal;
                    changed = true;
                }
            }
            if (changed) await put('cacheMembers', members);
            return ids;
        });
        await mapWithConcurrency(candidates, workloadConcurrency('RSS_IDLE_CHECK_CONCURRENCY', Math.min(2, cpuCapacity())), check);
    }
    return { check, observe };
}
