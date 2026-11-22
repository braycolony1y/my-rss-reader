import { classifyArticleFetchRequest } from './fetch-lanes.js';

// Speculation must not impersonate a user and postpone every background job.
export function beginArticleRequest(req, progress) {
    const foreground = classifyArticleFetchRequest(req) === 'p0';
    if (foreground) progress.activeForegroundRequests++;
    let released = false;
    return () => {
        if (!released && foreground) progress.activeForegroundRequests = Math.max(0, progress.activeForegroundRequests - 1);
        released = true;
    };
}
