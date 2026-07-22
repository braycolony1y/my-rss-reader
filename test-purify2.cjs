const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');
const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);
const doc = window.document;

const html = `<figure class="image align-center" contenteditable="false"><img title="Cầu thủ Argentina cay cú lao vào hành hung, bóp cổ ngôi sao Tây Ban Nha - 1" src="data:image/svg+xml;charset=utf-8,%3Csvg xmlns%3D'http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg' viewBox%3D'0 0 1200 916'%3E%3Crect x='0' y='0' width='100%' height='100%' style='fill:rgb(241, 245, 249)' %2F%3E%3C%2Fsvg%3E" alt="Cầu thủ Argentina cay cú lao vào hành hung, bóp cổ ngôi sao Tây Ban Nha - 1" data-width="1200" data-height="916" data-original="https://cdnphoto.dantri.com.vn/Sov_jpR6p4wdxauUr71LUFRv49o=/2026/07/20/c73191aa4239ed592ae43748d65be529-1784504942781.jpg" data-photo-id="4128867" data-track-content="" data-content-name="article-content-image" data-content-piece="article-content-image_4128867" data-content-target="/the-thao/cau-thu-argentina-cay-cu-lao-vao-hanh-hung-bop-co-ngoi-sao-tay-ban-nha-20260720065238823.htm" data-src="https://cdnphoto.dantri.com.vn/d4o0In1ECCqhOqYW3FZVk2GNhCE=/thumb_w/1020/2026/07/20/c73191aa4239ed592ae43748d65be529-1784504942781.jpg" data-srcset="https://cdnphoto.dantri.com.vn/d4o0In1ECCqhOqYW3FZVk2GNhCE=/thumb_w/1020/2026/07/20/c73191aa4239ed592ae43748d65be529-1784504942781.jpg 1x, https://cdnphoto.dantri.com.vn/0p4bTUvr52cc0qymb2QroZ6Ft_A=/thumb_w/1360/2026/07/20/c73191aa4239ed592ae43748d65be529-1784504942781.jpg 2x"><figcaption><p>Hai cầu thủ Argentina lao vào tấn công Gavi (Ảnh: Reuters).</p></figcaption></figure>`;

doc.body.innerHTML = DOMPurify.sanitize(html, {
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

console.log(doc.body.innerHTML);
