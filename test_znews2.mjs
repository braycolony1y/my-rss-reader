import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
async function run() {
    const html = await fetch("https://znews.vn/real-madrid-thong-tri-world-cup-theo-cach-khong-ngo-post1671317.html", {
        headers: { 'User-Agent': 'Mozilla/5.0' }
    }).then(r => r.text());
    
    const $ = cheerio.load(html);
    const body = $('.the-article-body').html();
    // find elements that have a href linking to znews articles
    const links = $('.the-article-body a[href*="znews.vn"]');
    links.each((i, el) => {
        console.log("LINK:", $(el).attr('href'), $(el).text().substring(0, 30).replace(/\n/g, ' '));
        console.log("PARENT:", $(el).parent()[0].tagName, $(el).parent().attr('class'));
    });
}
run();
