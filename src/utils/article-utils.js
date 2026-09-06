import { normalizeArticleSourceUrl } from '../article-source-state.js';
import sourceRegistry from '../sources/index.js';

function fnv1a(str) {
    let hash = 2166136261;
    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return (hash >>> 0).toString(16);
}

function escapeHtml(text = '') {
    return String(text).replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[char]);
}

function safeHttpUrl(value) {
    try {
        const parsed = new URL(value);
        return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '';
    } catch (e) {
        return '';
    }
}

function cleanUrl(url) {
    if (!url) return '';
    const normalizedUrl = normalizeArticleSourceUrl(url);
    try {
        let u = new URL(normalizedUrl);

        let sourceHandler = sourceRegistry.getHandler(normalizedUrl);
        if (sourceHandler && sourceHandler.cleanUrl) {
            let handledUrl = sourceHandler.cleanUrl(u);
            if (handledUrl) return normalizeArticleSourceUrl(handledUrl);
        }

        let params = new URLSearchParams(u.search);
        let keysToDelete = [];
        for (let key of params.keys()) {
            if (key.toLowerCase().startsWith('utm_') || key.toLowerCase() === 'ref') keysToDelete.push(key);
        }
        keysToDelete.forEach(k => params.delete(k));
        u.search = params.toString();
        return normalizeArticleSourceUrl(u.toString());
    } catch (e) {
        return normalizedUrl.split('?utm_')[0];
    }
}

const isInvalidImage = (url) => {
    if (!url || typeof url !== 'string' || url === 'null') return true;
    const lower = url.trim().toLowerCase();
    if (/^\d+$/.test(lower) || lower === 'image/jpeg' || lower === 'image/jpg' || lower === 'image/png' || lower === 'image/webp' || lower === 'image/gif') return true;
    if (!lower.startsWith('http://') && !lower.startsWith('https://') && !lower.startsWith('/') && !lower.startsWith('data:image')) return true;
    const dimMatch = lower.match(/\/(?:zoom|thumb)\/(\d+)_(\d+)\//);
    if (dimMatch && (parseInt(dimMatch[1]) < 300 || parseInt(dimMatch[2]) < 200)) return true;
    if (lower.includes('/36_36/') || lower.includes('/48_48/') || lower.includes('/60_60/') || lower.includes('/80_80/')) return true;
    return lower.includes('logo') || (lower.includes('avatar') && !/avatar\d{10}/.test(lower)) || lower.includes('author_default') || lower.includes('default_avatar') ||
        lower.includes('default-image') || lower.includes('default_image') || lower.includes('no-image') ||
        lower.includes('default.png') || lower.includes('default.jpg') || lower.includes('tto_default_avatar') ||
        lower.includes('tpo_social_share') || lower.includes('user-gray') || lower.includes('spinner') ||
        lower.includes('blank.gif') || lower.includes('smilie') || lower.includes('emoji') ||
        lower.includes('twemoji') || lower.includes('apple.com') || lower.startsWith('data:image') ||
        lower.includes('banner_gg_news') || lower.includes('/banner') || lower.includes('avplayer.com');
};

const decodeProxy = (url) => {
    if (url.includes('proxy.php?image=')) {
        try {
            const params = new URLSearchParams(url.split('?')[1]);
            if (params.get('image')) return params.get('image');
        } catch (e) { }
    }
    return url;
};

function extractImageFromHtml(html, baseUrl) {
    let foundImg = null;
    const checkCandidate = (candidate) => {
        if (!candidate) return null;
        let decoded = decodeProxy(candidate.replace(/&amp;/g, '&'));
        if (isInvalidImage(decoded)) return null;
        return decoded;
    };

    const metaTags = html.match(/<meta[^>]+>/ig) || [];
    for (let tag of metaTags) {
        if (/(property|name|itemprop)=["']?(og:image|twitter:image|twitter:image:src|image)["']?(?:\s|>|\/)/i.test(tag) && !tag.match(/image:(width|height|type|alt)/i)) {
            const contentMatch = tag.match(/content=["']([^"']+)["']/i);
            if (contentMatch && contentMatch[1]) {
                foundImg = checkCandidate(contentMatch[1]);
                if (foundImg) return foundImg;
            }
        }
    }

    const ldJsonMatches = html.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/ig);
    if (ldJsonMatches) {
        for (const block of ldJsonMatches) {
            try {
                const cleanJson = block.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '');
                const parsed = JSON.parse(cleanJson);
                const schemas = Array.isArray(parsed) ? parsed : [parsed];

                for (const schema of schemas) {
                    let candidate = null;
                    if (schema.image) {
                        if (typeof schema.image === 'string') candidate = schema.image;
                        else if (schema.image.url) candidate = schema.image.url;
                        else if (Array.isArray(schema.image) && schema.image.length > 0) {
                            candidate = typeof schema.image[0] === 'string' ? schema.image[0] : schema.image[0].url;
                        }
                    }
                    foundImg = checkCandidate(candidate);
                    if (foundImg) return foundImg;
                }
            } catch (e) { }
        }
    }

    const imgTags = html.match(/<img[^>]+>/ig) || [];
    for (let img of imgTags) {
        if (img.includes('bbImage') || img.includes('bbCodeBlockUnfurl-image') || img.includes('attachmentThumb')) {
            let srcMatch = img.match(/data-url=["']([^"']+)["']/i) || img.match(/data-src=["']([^"']+)["']/i) || img.match(/src=["']([^"']+)["']/i);
            if (srcMatch && srcMatch[1]) {
                foundImg = checkCandidate(srcMatch[1]);
                if (foundImg) return foundImg;
            }
        }
    }
    return null;
}

function publisherIcon(value) {
    let hostname = String(value || '').toLowerCase();
    try { hostname = new URL(hostname.includes('://') ? hostname : `https://${hostname}`).hostname.toLowerCase(); } catch (e) { }

    let sourceHandler = sourceRegistry.getHandler(hostname);
    if (sourceHandler && sourceHandler.publisherIcon) {
        let icon = sourceHandler.publisherIcon(hostname);
        if (icon) return icon;
    }

    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=64`;
}

async function mapWithConcurrency(items, concurrency, mapper) {
    const result = new Array(items.length);
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (nextIndex < items.length) {
            const index = nextIndex++;
            result[index] = await mapper(items[index], index);
        }
    });
    await Promise.all(workers);
    return result;
}

function normalizeStateUrl(url) {
    if (!url) return '';
    let u = normalizeArticleSourceUrl(url);
    if (u.includes('voz.vn/t/')) {
        u = u
            .replace(/[?#].*$/, '')
            .replace(/\/(?:unread|latest|page-\d+|post-\d+)\/?$/i, '')
            .replace(/\/$/, '');
    }
    return u.replace(/\/+$/, '');
}

class NormalizedSet extends Set {
    constructor(iterable) {
        super(iterable ? iterable.map(normalizeStateUrl) : []);
    }
    has(val) { return super.has(normalizeStateUrl(val)); }
}

class NormalizedMap extends Map {
    constructor(iterable) {
        super(iterable ? iterable.map(([key, value]) => [normalizeStateUrl(key), value]) : []);
    }
    get(key) { return super.get(normalizeStateUrl(key)); }
}

function normalizedHostname(value) {
    try {
        return new URL(String(value)).hostname.toLowerCase().replace(/^www\./, '');
    } catch (error) {
        return '';
    }
}

export { escapeHtml, safeHttpUrl, isInvalidImage, fnv1a, normalizeStateUrl, extractImageFromHtml, publisherIcon, cleanUrl, mapWithConcurrency, NormalizedSet, normalizedHostname, NormalizedMap, decodeProxy };
