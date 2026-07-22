const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');
const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

const html = `<figure class="image align-center" contenteditable="false"><img title="test" src="data:image/svg+xml;charset=utf-8,%3Csvg xmlns%3D'http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg' viewBox%3D'0 0 1200 916'%3E%3Crect x='0' y='0' width='100%' height='100%' style='fill:rgb(241, 245, 249)' %2F%3E%3C%2Fsvg%3E" alt="test" data-width="1200" data-height="916" data-original="https://cdnphoto.dantri.com.vn/Sov_jpR6p4wdxauUr71LUFRv49o=/2026/07/20/c73191aa4239ed592ae43748d65be529-1784504942781.jpg" data-src="https://cdnphoto.dantri.com.vn/d4o0In1ECCqhOqYW3FZVk2GNhCE=/thumb_w/1020/2026/07/20/c73191aa4239ed592ae43748d65be529-1784504942781.jpg" data-srcset="https://cdnphoto.dantri.com.vn/d4o0In1ECCqhOqYW3FZVk2GNhCE=/thumb_w/1020/2026/07/20/c73191aa4239ed592ae43748d65be529-1784504942781.jpg 1x, https://cdnphoto.dantri.com.vn/0p4bTUvr52cc0qymb2QroZ6Ft_A=/thumb_w/1360/2026/07/20/c73191aa4239ed592ae43748d65be529-1784504942781.jpg 2x"><figcaption><p>Hai cầu thủ Argentina</p></figcaption></figure>`;

const sanitized = DOMPurify.sanitize(html, {
    ADD_TAGS: ['iframe', 'video', 'audio', 'source', 'blockquote'],
    ADD_ATTR: ['allow', 'allowfullscreen', 'frameborder', 'scrolling', 'controls', 'autoplay', 'loop', 'muted', 'playsinline', 'poster', 'data-src', 'data-url', 'data-original', 'data-lazy-src']
});
console.log(sanitized);
