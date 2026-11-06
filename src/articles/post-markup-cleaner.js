import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import { createSanitizerDocumentScope } from './sanitizer-document-scope.js';
import { postIframePolicy } from './post-iframe-policy.js';

export function createPostMarkupCleaner({ window = new JSDOM('').window } = {}) {
    const purifier = createDOMPurify(window);
    const withinDocumentScope = createSanitizerDocumentScope(window, purifier);
    purifier.addHook('uponSanitizeElement', node => {
        if (node.nodeName !== 'IFRAME') return;
        const policy = postIframePolicy(node.getAttribute('src'));
        if (!policy) node.remove();
        else { node.removeAttribute('srcdoc'); node.setAttribute('sandbox', policy.sandbox); }
    });
    return html => withinDocumentScope(() => purifier.sanitize(html || '', {
        USE_PROFILES: { html: true },
        ADD_TAGS: ['iframe'],
        ADD_ATTR: ['allow', 'allowfullscreen', 'frameborder', 'sandbox', 'scrolling', 'target', 'referrerpolicy'],
        FORBID_ATTR: ['srcdoc']
    }));
}
