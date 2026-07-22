import fetch from 'node-fetch';
const url = 'https://voz.vn/t/hoi-nhung-nguoi-dung-macbook.1311/page-9999';
fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } })
.then(r => r.text())
.then(html => {
    const match = html.match(/<div[^>]*bbCodeBlock--unfurl[^>]*>[\s\S]{0,1000}/);
    if(match) console.log(match[0]);
    else console.log('no unfurl found');
});
