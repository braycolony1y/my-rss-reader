import fetch from 'node-fetch';
async function run() {
    const res = await fetch('https://voz.vn/f/diem-bao.33/');
    const text = await res.text();
    const threads = text.match(/<a href="(\/t\/bong-dung[^"]+)"/g);
    console.log(threads);
}
run();
