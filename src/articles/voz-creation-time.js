import fs from 'node:fs/promises';
import { absoluteTimestamp } from './source-time.js';
import { isVozThreadUrl, getVozThreadPageNumber, buildVozThreadPageUrl } from '../voz-thread-state.js';

// Thread creation belongs to page one. Never infer it from a reply or cache age.
export function vozCreationTimeUrl(url) {
    return isVozThreadUrl(url) ? buildVozThreadPageUrl(url, 1).replace(/\/unread\/?$/, '') : url;
}

export function vozThreadCreationTime(url, result) {
    if (!isVozThreadUrl(url) || !result || (getVozThreadPageNumber(url) || 1) !== 1
        || Number(result.pagination?.currentPage || 1) !== 1) return null;
    const opener = String(result.content || '').match(/<div\b(?=[^>]*\bclass=["']voz-post["'])(?=[^>]*\bdata-post-index=["']1["'])[^>]*>/i)?.[0];
    const created = opener?.match(/\bdata-source-created-at=["']([^"']+)["']/i)?.[1];
    return absoluteTimestamp(created) || absoluteTimestamp(result.date);
}

// Memoize only the date and file fingerprint, never thread bodies. Reads use
// the cache owner's page/safety/retention checks without normalizing post HTML.
export function createCachedThreadCreationLookup({ filename, readCached }) {
    const dates = new Map();
    return async url => {
        if (!isVozThreadUrl(url)) return null;
        const firstPage = vozCreationTimeUrl(url);
        const file = filename(firstPage);
        try {
            const stat = await fs.stat(file);
            const fingerprint = `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`;
            const prior = dates.get(file);
            if (prior?.fingerprint === fingerprint && !prior.sourceDeleted) return prior.date;
            const cached = await readCached(firstPage);
            const date = vozThreadCreationTime(firstPage, cached?.result);
            dates.delete(file);
            dates.set(file, {fingerprint, date, sourceDeleted:cached?.result?.sourceDeleted === true});
            while (dates.size > 512) dates.delete(dates.keys().next().value);
            return date;
        } catch {
            dates.delete(file);
            return null;
        }
    };
}
