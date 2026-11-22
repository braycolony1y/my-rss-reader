import {runPublisherFallbacks} from './publisher-fallbacks.js';
import {getCurrentArticleFetchLaneContext} from './fetch-lanes.js';

// Buffer the handler's final verdict so caught method failures are committed
// before sending JSON. Cache hits do not count as successful live recovery.
export function articleFallbackRequest(handler) {
    return async (req, res, next) => {
        if (!req.query?.url) return handler(req, res, next);
        const json = res.json;
        let payload, responded = false;
        res.json = value => {payload = value; responded = true; return res;};
        const context = getCurrentArticleFetchLaneContext();
        try {
            await runPublisherFallbacks(req.query.url, async () => {
                await handler(req, res, next);
                return payload;
            }, {kind: 'article', lane: context.lane, context, join: false, lazyAdmission: true});
        } catch (error) {
            if (error.code !== 'SOURCE_COOLDOWN') throw error;
            payload = {error: error.message, url: req.query.url, retryAt: error.retryAt};
            responded = true;
        } finally {
            res.json = json;
        }
        if (responded) return res.json(payload);
    };
}

export function articleFallbackAcquisition(acquire, options = {}) {
    return (url, ...args) => runPublisherFallbacks(url, () => acquire(url, ...args), {
        kind: 'article', join: false, lazyAdmission: true, ...options
    });
}
