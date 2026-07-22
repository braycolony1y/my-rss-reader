const fs = require('fs');
async function test() {
    const url = "https://voz.vn/t/thanh-nien-bi-tam-giam-vi-chui-boi-tren-mang.813038/"; // example
    const res = await fetch(url);
    const html = await res.text();
    const splitRegex = /<article\b[^>]*class=["'][^"']*message--post[^"']*["'][^>]*>/gi;
    let match = splitRegex.exec(html);
    const endTokenIndex = html.length;
    const artHtml = html.slice(match.index, endTokenIndex);
    
    const attrOppositeMatch = artHtml.match(/<ul\b[^>]*class=["'][^"']*message-attribution-opposite[^"']*["'][^>]*>([\s\S]*?)<\/ul>/i) || [null, artHtml];
    console.log(attrOppositeMatch[1]);
}
test().catch(console.error);
