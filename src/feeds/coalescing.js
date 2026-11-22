import { createCoalescedJob } from '../runtime/coalesced-job.js';
import {mergeManualRefreshScopes} from '../articles/manual-refresh-scopes.js';

// Automatic/full refreshes share one queue. Explicit source/category refreshes
// have their own scope queue so unrelated article ingestion cannot block them.
// Identical scopes still coalesce and retain every progress subscriber.
export function coalesceFeedSync(run, report) {
    const owners = new WeakMap();
    const notify = (listeners, progress) => {
        for (const listener of listeners) {
            try { listener(progress); }
            catch (error) { console.warn('[RSS PROGRESS]', error.message); }
        }
    };
    return (env, feed = null, onProgress = null, category = null, options = {}) => {
        let jobs = owners.get(env.RSS_DATA);
        if (!jobs) { jobs = new Map(); owners.set(env.RSS_DATA, jobs); }
        const scopedManual = options.manualRefreshScopes?.length && (feed || category);
        const key = scopedManual ? JSON.stringify([feed, category]) : 'background';
        let job = jobs.get(key);
        if (!job) {
            job = createCoalescedJob({ name: scopedManual ? 'rss-manual-refresh' : 'rss-refresh', report,
                run: input => run(env, input.feed, progress => notify(input.listeners, progress), input.category,
                    {forcedFeedUrls: input.forcedFeeds, manualRefreshScopes: input.manualRefreshScopes}),
                merge: (previous, next) => {
                    const same = previous.feed === next.feed && previous.category === next.category;
                    return {feed: same ? next.feed : null, category: same ? next.category : null,
                        forcedFeeds: new Set([...previous.forcedFeeds, ...next.forcedFeeds]),
                        manualRefreshScopes: mergeManualRefreshScopes(previous.manualRefreshScopes, next.manualRefreshScopes),
                        listeners: new Set([...previous.listeners, ...next.listeners])};
                }
            });
            jobs.set(key, job);
        }
        if (job.state().active && typeof onProgress === 'function') {
            notify([onProgress], {stage: 'queued', message: 'Waiting for an earlier refresh…', current: 0, total: 0});
        }
        const result = job.request({feed, category, forcedFeeds: new Set(feed ? [feed] : []),
            manualRefreshScopes: options.manualRefreshScopes || [],
            listeners: new Set(typeof onProgress === 'function' ? [onProgress] : [])});
        const cleanup = () => { if (!job.state().active && jobs.get(key) === job) jobs.delete(key); };
        void result.then(cleanup, cleanup);
        return result;
    };
}
