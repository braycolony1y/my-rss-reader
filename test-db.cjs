const Database = require('better-sqlite3');
const db = new Database('my-rss-reader.db');
const row = db.prepare("SELECT image FROM articles WHERE url='https://dantri.com.vn/the-thao/cau-thu-argentina-cay-cu-lao-vao-hanh-hung-bop-co-ngoi-sao-tay-ban-nha-20260720065238823.htm'").get();
console.log(row ? row.image : "NOT FOUND");
