import DantriSource from './src/sources/DantriSource.js';
const url = "https://dantri.com.vn/the-thao/cau-thu-argentina-cay-cu-lao-vao-hanh-hung-bop-co-ngoi-sao-tay-ban-nha-20260720065238823.htm";
fetch(url).then(res => res.text()).then(html => {
    const source = new DantriSource();
    const articleHtml = source.parseArticleHtmlContent(html, url, {}, {});
    console.log(articleHtml.includes("Hai cầu thủ Argentina lao vào tấn công Gavi"));
    console.log("Images found: " + (articleHtml.match(/<img/g) || []).length);
});
