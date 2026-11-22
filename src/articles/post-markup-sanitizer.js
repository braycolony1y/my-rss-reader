import { createStringCache } from '../cache/string-cache.js';
import { createPostMarkupCleaner } from './post-markup-cleaner.js';

const sanitize = createPostMarkupCleaner();

export function createPostSanitizer({ clean = sanitize, maxBytes = (Number(process.env.RSS_POST_MARKUP_CACHE_MB) || 16) * 1048576 } = {}) {
    const cache = createStringCache({ maxBytes });
    const sanitizePostMarkup = html => {
        if (typeof html !== 'string') return clean(html);
        const cached = cache.get(html);
        if (cached !== undefined) return cached;
        const output = clean(html);
        cache.set(html, output);
        return output;
    };
    return { sanitizePostMarkup, state: cache.state };
}
const sanitizer = createPostSanitizer();
export const sanitizePostMarkup = sanitizer.sanitizePostMarkup;
export const getPostSanitizerState = sanitizer.state;
