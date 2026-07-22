

const CF_PROXY_BASE = 'https://api.allorigins.win/raw?url=';

async function test() {
    // Voz uses a redirect for /post-ID urls. Let's just fetch the raw url and follow redirects.
    // wait, allorigins doesn't follow redirects well.
    // Let's ask allorigins for the actual page. Wait, allorigins CAN follow redirects if using the right endpoint, but /raw might not.
    // Let's use get endpoint
    const res = await fetch('https://api.allorigins.win/get?url=' + encodeURIComponent('https://voz.vn/t/dao-nay-di-ung-di-khap-thien-ha-qua-a.1259422/post-42984485'));
    const json = await res.json();
    const html = json.contents;
    const match = html.match(/<iframe[^>]+>/gi);
    console.log(match);
    const fullMatch = html.match(/<span\b[^>]*data-s9e-mediaembed[^>]*>[\s\S]*?<\/span>\s*<\/span>\s*<\/span>/gi);
    if(fullMatch) {
       console.log(fullMatch[0]);
    }
}
test();
