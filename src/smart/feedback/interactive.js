import { semantics as s } from './semantics.js';

// "Not interested" reasons are derived locally and deterministically from the article and the
// existing semantic rule pool. No model is consulted; when nothing matches, the caller falls back
// to the Other text box (Phase C replaces this picker with keyword suggestions).
export function createInteractiveReasons() {
    const cache = new Map();
    return async ({ article, rejected = [], input = '' }) => {
        const cacheKey = JSON.stringify([article.title, s.section(article), article.feedbackTraits, article.feedUrl, rejected, input]);
        if (cache.has(cacheKey)) return cache.get(cacheKey);
        const local = input ? s.interpret(input, article) : null;
        if (local) return { reasons: [local], interpretation: true };
        const pool = s.pool(article).filter(r => !s.isRejected(r.rule, rejected));
        if (!input && pool.length >= 4) return { reasons: pool.slice(0, 6) };
        // Nothing further can be derived locally; the reader can still describe a reason in the Other box.
        const message = input
            ? 'That reason could not be understood. Use Other to describe it differently.'
            : 'No further suggestions. Use Other to describe your reason.';
        const response = { reasons: input ? [] : pool.slice(0, 7), exhausted: true, retryable: false, message };
        cache.set(cacheKey, response);
        if (cache.size > 100) cache.delete(cache.keys().next().value);
        return response;
    };
}
