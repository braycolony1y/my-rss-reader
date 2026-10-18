import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import { createSanitizerDocumentScope } from './sanitizer-document-scope.js';

export function createPostMarkupCleaner({ window = new JSDOM('').window } = {}) {
    const purifier = createDOMPurify(window);
    const withinDocumentScope = createSanitizerDocumentScope(window, purifier);
    purifier.addHook('uponSanitizeElement', node => {
        if (node.nodeName !== 'IFRAME') return;
        try {
            const url = new URL(node.getAttribute('src'));
            const hosts = ['youtube.com', 'youtube-nocookie.com', 'player.vimeo.com', 'tiktok.com', 'player.bilibili.com', 'dailymotion.com', 'facebook.com', 'instagram.com', 'platform.twitter.com', 'redditmedia.com', 'reddit.com'];
            if (url.protocol !== 'https:' || !hosts.some(host => url.hostname === host || url.hostname.endsWith('.' + host))) node.remove();
            else { node.removeAttribute('srcdoc'); node.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-presentation'); }
        } catch { node.remove(); }
    });
    return html => withinDocumentScope(() => purifier.sanitize(html || '', {
        USE_PROFILES: { html: true },
        ADD_TAGS: ['iframe'],
        ADD_ATTR: ['allow', 'allowfullscreen', 'frameborder', 'sandbox', 'scrolling', 'target', 'referrerpolicy'],
        FORBID_ATTR: ['srcdoc']
    }));
}
