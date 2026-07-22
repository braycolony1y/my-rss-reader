const targetUrl = 'https://dantri.com.vn/thoi-tiet/mien-bac-giam-mua-nhieu-noi-nang-nong-20260720215519144.htm';
const res = await fetch(targetUrl);
const html = await res.text();
import fs from 'fs';
fs.writeFileSync('scratch_dantri_article.html', html);
console.log('done', html.length);
