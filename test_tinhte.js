async function run() {
    const res = await fetch('https://tinhte.vn/thread/xua-thich-ipad-m1-op-ban-phim-apple-bo-balo-no-nang-hon-ca-con-macbook-16inch-rang-khong-noi.4161478/', {
        headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const html = await res.text();
    const bbIndex = html.indexOf('bbWrapper');
    if (bbIndex !== -1) {
        console.log("Found bbWrapper!");
        const content = html.substring(bbIndex, bbIndex + 3000);
        const images = [...content.matchAll(/<img[^>]*>/gi)];
        for (let img of images) {
            console.log(img[0]);
        }
    } else {
        console.log("No bbWrapper found");
    }
}
run();
