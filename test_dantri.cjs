const fs = require('fs');
const jsdom = require("jsdom");
const { JSDOM } = jsdom;

const html = `
<figure class="image align-center" contenteditable="false"><img src="https://cdnphoto.dantri.com.vn/547RCEnuNEYbPs7ukdx59LYSjPU=/thumb_w/1020/2026/07/21/ta-hienhk01-1784648220888.png" title="Bố Tạ Đình Phong: Người đàn ông đào hoa nhưng sống trọn nghĩa tình - 1" alt="Bố Tạ Đình Phong: Người đàn ông đào hoa nhưng sống trọn nghĩa tình - 1" data-width="651" data-height="546" data-photo-id="4131452" data-track-content="" data-content-name="article-content-image" data-content-piece="article-content-image_4131452" data-content-target="/giai-tri/bo-ta-dinh-phong-nguoi-dan-ong-dao-hoa-nhung-song-tron-nghia-tinh-20260721225209732.htm"><figcaption><p>Tạ Hiền và bạn gái đầu tiên - Gia Linh (Ảnh: HK01).</p></figcaption></figure>
`;

const scriptContent = fs.readFileSync('script.js', 'utf8');

const doc = new JSDOM(html).window.document;

// Simulate beautifyArticleHtml
doc.querySelectorAll('img').forEach(media => {
    const width = Number(media.getAttribute('width') || 0);
    const height = Number(media.getAttribute('height') || 0);
    if ((width && width <= 2) || (height && height <= 2)) {
        console.log("REMOVED BY WIDTH/HEIGHT:", media.outerHTML);
        media.remove();
    }
});

console.log("FINAL HTML:", doc.body.innerHTML);
