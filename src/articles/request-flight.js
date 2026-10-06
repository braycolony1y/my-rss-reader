// Share complete extraction only for equivalent reader requests. Keep policy,
// explicit refresh/reject, pagination and prefetch side effects isolated.
export function createArticleRequestFlight({ updateArticleFetchProgress, finishArticleFetchProgress } = {}) {
    const flights = new Map();
    return function singleFlight(handler) {
        return async (req, res, next) => {
            if (!req.query.url || req.query.strategy || req.query.reject || req.query.exclude || req.query.bypassCache) return handler(req, res, next);
            const entries = Object.entries(req.query).filter(([key]) => !['requestId', '_t'].includes(key)).sort(([a], [b]) => a.localeCompare(b));
            const key = JSON.stringify(entries);
            const previous = flights.get(key);
            if (previous) {
                const requestId = String(req.query.requestId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
                updateArticleFetchProgress?.(requestId, 'fetching', 'Waiting for the article already being loaded…');
                const result = await previous;
                finishArticleFetchProgress?.(requestId, result.error || result.payload?.error ? 'Article loading failed.' : 'Article is ready.', { failed: Boolean(result.error || result.payload?.error) });
                if (!res.destroyed && !res.writableEnded) {
                    if (result.error) return next(result.error);
                    return res.status(result.status).json(result.payload);
                }
                return;
            }
            let complete;
            const promise = new Promise(resolve => { complete = resolve; });
            flights.set(key, promise);
            const json = res.json.bind(res);
            let result;
            res.json = payload => { result = { status: res.statusCode || 200, payload }; return json(payload); };
            try {
                await handler(req, res, next);
                result ||= { error: new Error('Article request ended without a response') };
            } catch (error) {
                result = { error };
                throw error;
            } finally {
                flights.delete(key);
                complete(result);
            }
        };
    };
}
