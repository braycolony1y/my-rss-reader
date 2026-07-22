import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
async function run() {
    const html = await fetch("https://znews.vn/real-madrid-thong-tri-world-cup-theo-cach-khong-ngo-post1671317.html", {
        headers: { 'User-Agent': 'Mozilla/5.0' }
    }).then(r => r.text());
    
    const $ = cheerio.load(html);
    const related = $('.inner-article, .article-item, .box-category-item, article');
    console.log("Found:", related.length);
    related.each((i, el) => {
        console.log("CLASS:", $(el).attr('class'), $(el).find('a').attr('href'));
    });
}
run();
