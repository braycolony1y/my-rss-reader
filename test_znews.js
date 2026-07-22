const ZnewsSource = require('./src/sources/ZnewsSource.js');
const fetch = require('node-fetch');
const utils = require('./src/utils.js');

async function run() {
    const html = await fetch("https://znews.vn/real-madrid-thong-tri-world-cup-theo-cach-khong-ngo-post1671317.html", {
        headers: { 'User-Agent': 'Mozilla/5.0' }
    }).then(r => r.text());
    
    const source = new ZnewsSource();
    const result = { link: "https://znews.vn/real-madrid-thong-tri-world-cup-theo-cach-khong-ngo-post1671317.html" };
    source.parseArticleHtmlContent(html, result.link, result, utils);
    console.log(result.html.substring(0, 500));
    console.log("...");
    console.log(result.html.substring(result.html.length - 1500));
}
run();
