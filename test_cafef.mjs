import fs from 'fs';
import CafeFSource from './src/sources/CafeFSource.js';

async function test() {
    const url = 'https://cafef.vn/hon-3400-vien-kim-cuong-nhap-lau-duoc-dua-vao-he-thong-ban-le-sjc-188260722155540365.chn';
    const res = await fetch(url);
    const html = await res.text();
    fs.writeFileSync('test_cafef_raw.html', html);
}
test();
