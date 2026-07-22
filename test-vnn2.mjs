import VietnamnetSource from './src/sources/VietnamnetSource.js';

async function test() {
    const res = await fetch("https://vietnamnet.vn/danh-tinh-tai-xe-o-to-7-cho-khong-nhuong-duong-cho-xe-cuu-thuong-suot-5km-2536738.html");
    let html = await res.text();
    const source = new VietnamnetSource();
    
    const utils = {
        fetchWithTimeout: (url, opts, t) => fetch(url, opts)
    };
    
    html = await source.preProcessHtml(html, utils);
    const result = {};
    const parsed = await source.parseArticleHtmlContent(html, "https://vietnamnet.vn/danh-tinh-tai-xe-o-to-7-cho-khong-nhuong-duong-cho-xe-cuu-thuong-suot-5km-2536738.html", result, utils);
    
    console.log("Sections count:", (parsed.match(/embedded-suggested-articles/g) || []).length);
    console.log("Headers count:", (parsed.match(/BÀI VIẾT LIÊN QUAN/g) || []).length);
    import('fs').then(fs => fs.writeFileSync('test_vnn2.html', parsed));
}
test();
