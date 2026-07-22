const { JSDOM } = require("jsdom");
const dom = new JSDOM();
global.DOMParser = dom.window.DOMParser;

const html = `<div class="voz-post-body">Đang thất nghiệp...</div><div class="voz-post-reactions" style="margin-top:8px; padding-top:8px; border-top:1px solid rgba(255,255,255,0.04); display:flex; align-items:center; gap:8px; font-size:12px; color:#6b7280; overflow:hidden;"><div style="display:flex; align-items:center; margin-right:4px;"><img src="https://statics.voz.tech/styles/next/xenforo/reactions/popo/sweet_kiss.png?v=01" srcset="https://statics.voz.tech/styles/next/xenforo/reactions/popo/sweet_kiss_x2.png?v=01 2x" alt="Ưng" title="Ưng" style="width:18px; height:18px; object-fit:contain; flex-shrink:0;" class="voz-reaction-icon"></div><a href="/p/42970590/reactions" target="_blank" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:inherit; text-decoration:none;" class="hover:text-gray-400 transition-colors">natehigg , Rank up: , Dream_Sky and 8 others</a></div>`;

function beautifyArticleHtml(html, title = '') {
    if (!html) return '';
    const doc = new DOMParser().parseFromString(String(html), 'text/html');
    doc.querySelectorAll('script,style,template,nav,aside,form,noscript,button,[aria-hidden="true"]').forEach(node => node.remove());
    const noise = /(?:advert|adsbygoogle|breadcrumb|pagination|related|recommend|share|social|signature|message-user|message-attribution|message-footer|post-meta|author-box|author-info|user-panel|member-header|comment-list|comments-area|newsletter|subscribe|trending|popular-post|read-more|tags-list)/i;
    doc.body.querySelectorAll('*').forEach(node => {
        const marker = [node.id, node.className, node.getAttribute('role')].filter(value => typeof value === 'string').join(' ');
        if (noise.test(marker)) {
            node.remove();
            return;
        }
        node.removeAttribute('style');
        node.removeAttribute('height');
        node.removeAttribute('min-height');
        node.removeAttribute('max-height');
        [...node.attributes].forEach(attribute => {
            if (/^on/i.test(attribute.name)) node.removeAttribute(attribute.name);
        });
    });
    doc.body.querySelectorAll('div,section,ul').forEach(node => {
        if (!node.isConnected) return;
        const textLength = (node.textContent || '').replace(/\s+/g, ' ').trim().length;
        const links = [...node.querySelectorAll('a')];
        const linkLength = links.reduce((sum, link) => sum + (link.textContent || '').trim().length, 0);
        if (links.length >= 4 && textLength > 0 && linkLength / textLength > 0.78) node.remove();
    });
    
    // Boundary omitted for brevity
    
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
    
    doc.body.querySelectorAll('a:not(.voz-post-index)').forEach(link => link.replaceWith(...link.childNodes));
    
    for (let pass = 0; pass < 4; pass++) {
        doc.body.querySelectorAll('p:empty,div:empty,span:empty,section:empty,figure:empty').forEach(node => node.remove());
    }
    return doc.body.innerHTML.trim();
}

console.log(beautifyArticleHtml(html));
