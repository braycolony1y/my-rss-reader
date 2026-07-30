import fetch from 'node-fetch';

async function test() {
    try {
        const url = "https://rss-proxy.k1d.workers.dev/?url=" + encodeURIComponent("https://voz.vn/t/viet-nam-truoc-nguong-cua-thu-nhap-cao-thap-ky-quyet-dinh.1263289/unread");
        const res = await fetch(url);
        const html = await res.text();
        const matches = html.match(/<div[^>]*class=["'][^"']*message-avatar-wrapper[^"']*["'][^>]*>([\s\S]*?)<\/div>/ig);
        if (matches) {
            console.log(matches.slice(0, 3).join('\n\n'));
        } else {
            console.log("No avatar wrappers found");
        }
    } catch (e) {
        console.error(e);
    }
}
test();
