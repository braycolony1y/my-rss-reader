import fs from 'fs';
import fetch from 'node-fetch';

async function run() {
    const res = await fetch('https://voz.vn/t/bat-giu-doi-tuong-o-ha-noi-ca-do-bong-da-qua-mang-8xbet.1261735/');
    const html = await res.text();
    const matches = [...html.matchAll(/class="message-attribution-opposite message-attribution-opposite--list "([\s\S]*?)<\/ul>/gi)];
    matches.forEach((m, i) => {
        const anchors = [...m[1].matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)];
        const text = anchors.map(a => a[1].replace(/<[^>]+>/g, '').trim()).find(t => /^#\d+$/.test(t));
        console.log(`Post ${i+1}: ${text}`);
    });
}
run();
