const { open } = require('lmdb');
const db = open({ path: 'data/articles', compression: true });
const url = "https://dantri.com.vn/the-thao/cau-thu-argentina-cay-cu-lao-vao-hanh-hung-bop-co-ngoi-sao-tay-ban-nha-20260720065238823.htm";
const article = db.get(url);
console.log("Article:", article ? {title: article.title, image: article.image} : "NOT FOUND");
