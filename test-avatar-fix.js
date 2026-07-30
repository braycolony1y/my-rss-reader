import fetch from 'node-fetch';
async function run() {
    const res = await fetch('https://voz.vn/t/tong-thong-putin-khang-dinh-nen-kinh-te-nga-van-on-dinh-bat-chap-moi-kho-khan.1263305/');
    const text = await res.text();
    const avatarMatch = text.match(/class=["'][^"']*avatar\b[^>]*>\s*<img\b[^>]*src=["']([^"']+)["']/i);
    console.log(avatarMatch ? avatarMatch[1] : 'null');
}
run();
