import fetch from 'node-fetch';
async function run() {
    const res = await fetch('https://voz.vn/t/tong-thong-putin-khang-dinh-nen-kinh-te-nga-van-on-dinh-bat-chap-moi-kho-khan.1263305/page-2');
    const text = await res.text();
    const matches2 = text.match(/<div[^>]*data-media-site-id=["'][^"']*["'][^>]*>[\s\S]*?<\/div>/gi);
    if (matches2) {
         console.log("Found other media blocks:");
         matches2.forEach(m => console.log(m.substring(0, 500)));
    } else {
         console.log("Not found.");
    }
}
run();
