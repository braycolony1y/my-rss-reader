import fs from "fs";
const html = fs.readFileSync("vnn_test.html", "utf8");
const r = /<div\b[^>]*class=["'][^"']*(?:maincontent|main-content)[^"']*["'][^>]*>([\s\S]*?)(?:<!-- BEGIN COMPONENT::|<div\b[^>]*id=["']vnnid-box-vote|<div\b[^>]*class=["'][^"']*container__right|<div\b[^>]*class=["'][^"']*collectInfomationBox)/i;
const match = html.match(r);
if (match) {
  console.log("Matched!");
} else {
  console.log("No match");
}
