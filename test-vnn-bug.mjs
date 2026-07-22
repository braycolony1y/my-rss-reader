import VietnamnetSource from './src/sources/VietnamnetSource.js';

async function test() {
    const url = "https://vietnamnet.vn/danh-tinh-tai-xe-o-to-7-cho-khong-nhuong-duong-cho-xe-cuu-thuong-suot-5km-2536738.html";
    const res = await fetch(url);
    let html = await res.text();
    const source = new VietnamnetSource();
    
    // Simulate utils
    const utils = {
        fetchWithTimeout: (url, opts, t) => fetch(url, opts)
    };
    
    html = await source.preProcessHtml(html, utils);
    const result = {};
    const parsed = await source.parseArticleHtmlContent(html, url, result, utils);
    
    import('fs').then(fs => fs.writeFileSync('test_bug.html', parsed));
    console.log("Wrote test_bug.html");
}
test();
