const res = await fetch('https://www.vietnamplus.vn/benh-vien-bach-mai-co-so-ninh-binh-bao-dong-do-cuu-8-nan-nhan-ngo-doc-khi-post1125344.vnp');
const text = await res.text();
import fs from 'fs';
fs.writeFileSync('scratch_vietnamplus.html', text);
console.log('done', text.length);
