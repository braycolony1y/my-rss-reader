const puppeteer = require('puppeteer');
(async () => {
    const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.goto('https://tinhte.vn/thread/xua-thich-ipad-m1-op-ban-phim-apple-bo-balo-no-nang-hon-ca-con-macbook-16inch-rang-khong-noi.4161478/', { waitUntil: 'networkidle2' });
    const html = await page.content();
    require('fs').writeFileSync('tinhte.html', html);
    await browser.close();
})();
