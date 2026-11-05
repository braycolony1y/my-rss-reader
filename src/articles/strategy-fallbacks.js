import {runPublisherFallbacks} from './publisher-fallbacks.js';

export function runArticleStrategies(url, strategies, attempt, {lane = 'p3', accepted = result => Boolean(result), ...options} = {}) {
    return runPublisherFallbacks(url, async () => {
        let lastError;
        for (const strategy of strategies) {
            try {
                const result = await attempt(strategy);
                if (accepted(result)) return result;
            } catch (error) {lastError = error;}
        }
        if (lastError) throw lastError;
        return null;
    }, {kind: 'article', lane, join: false, ...options});
}
