import fs from "fs";
import source from "./src/sources/VietnamnetSource.js";
const html = fs.readFileSync("/home/ubuntu/vnn_test.html", "utf8");
const s = new source();
const result = {};
const parsed = s.parseArticleHtmlContent(html, "https://vietnamnet.vn/test.html", result, {});
console.log(parsed.includes("embedded-related-articles") ? "Success: has carousel" : "No carousel");
console.log(parsed.includes("Quốc lộ biến thành") ? "Success: has Quoc lo" : "No Quoc lo");
