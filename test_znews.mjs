import fetch from 'node-fetch';
async function run() {
    const html = await fetch("https://znews.vn/real-madrid-thong-tri-world-cup-theo-cach-khong-ngo-post1671317.html", {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    }).then(r => r.text());
    
    // Find where the related articles might be
    const lines = html.split('\n');
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes("tin liên quan") || lines[i].includes("the-article-body") || lines[i].includes("inner-article")) {
            console.log("LINE:", lines[i].substring(0, 200));
        }
    }
}
run();
