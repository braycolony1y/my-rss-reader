import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import { createStringCache } from '../cache/string-cache.js';

const purifier = createDOMPurify(new JSDOM('').window);
purifier.addHook('uponSanitizeElement', node => {
    if (node.nodeName !== 'IFRAME') return;
    try {
        const url = new URL(node.getAttribute('src'));
        const hosts = ['youtube.com', 'youtube-nocookie.com', 'player.vimeo.com', 'tiktok.com', 'player.bilibili.com', 'dailymotion.com', 'facebook.com', 'instagram.com', 'platform.twitter.com', 'redditmedia.com', 'reddit.com'];
        if (url.protocol !== 'https:' || !hosts.some(host => url.hostname === host || url.hostname.endsWith('.' + host))) node.remove();
        else { node.removeAttribute('srcdoc'); node.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-presentation'); }
    } catch { node.remove(); }
});
const sanitize = html => purifier.sanitize(html || '', { USE_PROFILES: {html:true}, ADD_TAGS:['iframe'], ADD_ATTR:['allow', 'allowfullscreen', 'frameborder', 'sandbox', 'scrolling', 'target', 'referrerpolicy'], FORBID_ATTR:['srcdoc'] });

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
