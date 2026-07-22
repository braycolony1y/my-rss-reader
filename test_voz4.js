const url = 'https://api.allorigins.win/raw?url=' + encodeURIComponent('https://voz.vn/t/dao-nay-di-ung-di-khap-thien-ha-qua-a.1259422/post-42984485');

async function test() {
    const res = await fetch(url);
    const html = await res.text();
    const match = html.match(/<article[^>]*data-content="post-42984485"[^>]*>([\s\S]*?)<\/article>/i) || html.match(/<article[^>]*id="post-42984485"[^>]*>([\s\S]*?)<\/article>/i) || html.match(/id="post-42984485"[^>]*>([\s\S]*?)<\/div>/i);
    if (match) {
        console.log("Post HTML:", match[1]);
    } else {
        console.log("Post not found");
    }
}
test();
