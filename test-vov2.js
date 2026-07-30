import fs from 'fs';
const res = await fetch('http://vov.vn/chinh-tri/da-nang-dieu-dong-bo-nhiem-nhieu-can-bo-chu-chot-post1317400.vov');
console.log(res.status);
console.log((await res.text()).slice(0, 200));
