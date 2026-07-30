const { JSDOM } = require('jsdom');
const targetUrl = 'https://cafef.vn/hon-3400-vien-kim-cuong-nhap-lau-duoc-dua-vao-he-thong-ban-le-sjc-188260722155540365.chn';

async function run() {
    const res = await fetch(targetUrl);
    const html = await res.text();
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    const body = doc.querySelector('.detail-content') || doc.body;
    
    // Find potential spam containers
    const spam = body.querySelectorAll('.tindnd, .tinlienquan, .related-news, .chisochungkhoan, .tintucsukien, [data-marked-zoneid], .VCSortableInPreviewMode[type="RelatedNews"]');
    spam.forEach(node => {
        console.log("Found spam node:", node.className, node.getAttribute('data-marked-zoneid'));
    });
}
run();
