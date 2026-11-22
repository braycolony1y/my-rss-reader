import { cleanGoogleNewsDestination, googleNewsArticleId } from './google-news-decode.js';
import { isExactGoogleNewsDecode, matchesGoogleNewsPublisher } from '../google-news-destination.js';

export function googleNewsRepairDestination(wrapper, mapping, hints) {
    if (!mapping || !googleNewsArticleId(wrapper)) return '';
    const destination = cleanGoogleNewsDestination(typeof mapping === 'string' ? mapping : mapping?.resolvedUrl);
    return destination && (isExactGoogleNewsDecode(mapping?.source) || matchesGoogleNewsPublisher(destination, hints)) ? destination : '';
}

export function setGoogleNewsArticleDestination(article, destination, source) {
    const wrapper = article.link;
    article.originalLink = wrapper;
    article.link = destination;
    if (source) article.googleNewsDecodeSource = source;
    for (const field of ['articleKey', 'clusterId', '_activeClusterId', 'resolvedLink']) {
        if (article[field] === wrapper || (field === 'resolvedLink' && googleNewsArticleId(article[field]))) {
            article[field] = destination;
        }
    }
    article.domain = new URL(destination).hostname.replace(/^www\./, '');
    article.feedIcon = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(article.domain)}&sz=64`;
    if (typeof article.image === 'string' && article.image.startsWith('/api/og-image?')) {
        article.image = article.image.replace(/([?&]url=)[^&#]*/, (_, prefix) => prefix + encodeURIComponent(destination));
    }
}

export function applyGoogleNewsDestinations(value, destinations, { recursive = true, onRepair } = {}) {
    if (!value || typeof value !== 'object') return false;
    let changed = false;
    if (!Array.isArray(value) && typeof value.link === 'string') {
        const original = value.link;
        const mapping = destinations[original];
        const destination = googleNewsRepairDestination(original, mapping, value);
        if (destination) {
            setGoogleNewsArticleDestination(value, destination, mapping?.source);
            onRepair?.(original, destination);
            changed = true;
        }
    }
    if (!recursive) return changed;
    for (const child of Object.values(value)) {
        if (child && typeof child === 'object') changed = applyGoogleNewsDestinations(child, destinations, { onRepair }) || changed;
    }
    return changed;
}
