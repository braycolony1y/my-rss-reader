import {runArticleFetchTask, withArticleFetchLane} from '../articles/fetch-lanes.js';

// The enclosing feed attempt owns verification failure after all methods fail.
// Nested browser work keeps its queue priority and its enclosing RSS admission.
export function runFeedBrowserFallback(url, task) {
    return withArticleFetchLane('p3', () => runArticleFetchTask(url, task), {
        source: 'rss-feed', recordVerification: false
    });
}
