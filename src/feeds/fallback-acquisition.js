import {withPublisherFetchKind} from '../articles/publisher-fetch-context.js';
import {runPublisherFallbacks} from '../articles/publisher-fallbacks.js';

export function rssFallbackAcquisition(acquire) {
    return (source, ...args) => withPublisherFetchKind('rss', async () => {
        try {
            return await runPublisherFallbacks(source.url, () => acquire(source, ...args), {
                kind: 'rss', urls: [source.url, source.fallbackUrl].filter(Boolean)
            });
        } catch (error) {
            if (error.code !== 'SOURCE_COOLDOWN') throw error;
            return {source, articles: [], ok: false, error: error.message};
        }
    });
}
