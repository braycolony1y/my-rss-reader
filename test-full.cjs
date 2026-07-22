const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');
const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);
const doc = window.document;
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

(async () => {
    const { default: DantriSource } = await import('./src/sources/DantriSource.js');
    const url = "https://dantri.com.vn/the-thao/cau-thu-argentina-cay-cu-lao-vao-hanh-hung-bop-co-ngoi-sao-tay-ban-nha-20260720065238823.htm";
    const html = await (await fetch(url)).text();
    const source = new DantriSource();
    const articleHtml = source.parseArticleHtmlContent(html, url, {}, {});
    
    doc.body.innerHTML = DOMPurify.sanitize(articleHtml, {
        ADD_TAGS: ['iframe', 'video', 'audio', 'source', 'blockquote'],
        ADD_ATTR: ['allow', 'allowfullscreen', 'frameborder', 'scrolling', 'controls', 'autoplay', 'loop', 'muted', 'playsinline', 'poster', 'data-src', 'data-url', 'data-original', 'data-lazy-src']
    });

    doc.body.querySelectorAll('img,video,audio').forEach(media => {
        const lazy = media.getAttribute('data-src') || media.getAttribute('data-url') || media.getAttribute('data-original') || media.getAttribute('data-lazy-src');
        if (lazy) media.setAttribute('src', lazy);
        const mediaMarker = [media.getAttribute('src'), media.getAttribute('alt'), media.getAttribute('class')].filter(Boolean).join(' ');
        if (/(?:newsletter|captcha|default[-_ ]?avatar|userdeff?ault|draggable-icon|cmsads|admicro|doubleclick|googlesyndication)/i.test(mediaMarker)) {
            media.remove();
            return;
        }
        const width = Number(media.getAttribute('width') || 0);
        const height = Number(media.getAttribute('height') || 0);
        if ((width && width <= 2) || (height && height <= 2)) media.remove();
    });

    for (let pass = 0; pass < 4; pass++) {
        doc.body.querySelectorAll('p:empty,div:empty,span:empty,section:empty,figure:empty').forEach(node => node.remove());
    }

    console.log(doc.body.innerHTML.match(/<figure[\s\S]*?<\/figure>/)?.[0]);
})();
