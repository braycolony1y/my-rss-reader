const html = await (await fetch("https://www.uob.com.vn/privilege-en/market-insights.page")).text();
const cardRegex = /<div class="card [^>]*>[\s\S]*?<img[^>]*class="[^"]*card-img-top[^"]*"[^>]*src=["']([^"']+)["'][^>]*>[\s\S]*?<h4 class="card-title[^>]*>([\s\S]*?)<\/h4>[\s\S]*?<p class="paragraph">([\s\S]*?)<\/p>[\s\S]*?<a href=["']([^"']+)["'][^>]*class="dtm-button"/gi;
let match;
let count = 0;
while ((match = cardRegex.exec(html)) !== null) {
    count++;
}
console.log("Matches:", count);
