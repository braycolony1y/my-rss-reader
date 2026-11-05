import { createCoalescedJob } from '../runtime/coalesced-job.js';
import {mergeManualRefreshScopes} from '../articles/manual-refresh-scopes.js';

// There is one active fetch and at most one pending batch per database owner.
// Every pending scope and progress subscriber survives coalescing.
export function coalesceFeedSync(run, report) {
    const owners = new WeakMap();
    const notify = (listeners, progress) => {
        for (const listener of listeners) {
            try { listener(progress); }
            catch (error) { console.warn('[RSS PROGRESS]', error.message); }
        }
    };
    return (env, feed = null, onProgress = null, category = null, options = {}) => {
        let job = owners.get(env.RSS_DATA);
        if (!job) {
            job = createCoalescedJob({ name: 'rss-refresh', report,
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
            owners.set(env.RSS_DATA, job);
        }
        return job.request({feed, category, forcedFeeds: new Set(feed ? [feed] : []),
            manualRefreshScopes: options.manualRefreshScopes || [],
            listeners: new Set(typeof onProgress === 'function' ? [onProgress] : [])});
    };
}
