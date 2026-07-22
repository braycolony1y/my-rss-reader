import fs from 'fs';

async function test() {
    const url = 'https://tuoitre.vn/hlv-kim-sang-sik-myanmar-gio-khong-de-choi-nhung-toi-mong-doi-tuyen-viet-nam-ghi-nhieu-ban-10026071717330446.htm';
    const html = await (await fetch(url)).text();
    fs.writeFileSync('tuoitre_test.html', html);
    console.log("Wrote tuoitre_test.html");
}
test();
