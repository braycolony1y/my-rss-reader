const url = 'https://api.allorigins.win/raw?url=' + encodeURIComponent('https://voz.vn/t/chua-tung-co-nguoi-dan-toan-the-gioi-duoc-tu-bau-chon-top-ky-quan-duong-dai.1261449/post-42981902');

async function test() {
    const res = await fetch(url);
    const html = await res.text();
    const match = html.match(/<article[^>]*data-content="post-42981902"[^>]*>([\s\S]*?)<\/article>/i);
    if (match) {
        console.log("Post HTML:", match[1].match(/<img[^>]+>/g) || 'no images');
        console.log("Image wrappers:", match[1].match(/<div\b[^>]*class=["'][^"']*bbImageWrapper[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi));
    } else {
        console.log("Post not found");
    }
}
test();
