import { cleanGoogleNewsDestination, googleNewsArticleId } from './google-news-decode.js';
import { matchesGoogleNewsPublisher } from '../google-news-destination.js';

// Only article records and their derived link identities change. Saved/read/
// Board state remains keyed by the retained originalLink, as before.
export function applyGoogleNewsDestinations(value, destinations, { recursive = true } = {}) {
    if (!value || typeof value !== 'object') return false;
    let changed = false;
    if (!Array.isArray(value) && typeof value.link === 'string') {
        const original = value.link;
        const destination = googleNewsArticleId(original) ? cleanGoogleNewsDestination(destinations[original]) : '';
        if (destination && matchesGoogleNewsPublisher(destination, value)) {
            value.originalLink = original;
            value.link = destination;
            for (const field of ['articleKey', 'clusterId', '_activeClusterId', 'resolvedLink']) {
                if (value[field] === original || (field === 'resolvedLink' && googleNewsArticleId(value[field]))) value[field] = destination;
            }
            value.domain = new URL(destination).hostname.replace(/^www\./, '');
            value.feedIcon = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(value.domain)}&sz=64`;
            if (/^\/api\/og-image\?url=/.test(value.image || '')) value.image = `/api/og-image?url=${encodeURIComponent(destination)}`;
            changed = true;
        }
    }
    if (!recursive) return changed;
    for (const child of Object.values(value)) {
        if (child && typeof child === 'object') changed = applyGoogleNewsDestinations(child, destinations) || changed;
    }
    return changed;
}
