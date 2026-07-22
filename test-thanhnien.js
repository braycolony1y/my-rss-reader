import fs from 'fs';
import { execSync } from 'child_process';
import ThanhNienSource from './src/sources/ThanhNienSource.js';

const url = 'https://thanhnien.vn/lu-quet-o-lai-chau-lam-1-nguoi-chet-hon-4600-nguoi-bi-co-lap-185260717213044074.htm';
const cmd = `curl -s "${url}" > tn_test.html`;
execSync(cmd);
const html = fs.readFileSync('tn_test.html', 'utf-8');

const source = new ThanhNienSource();
const result = {};
const output = source.parseArticleHtmlContent(html, url, result, {});
console.log("Result:", result);
fs.writeFileSync('tn_out.html', output);
console.log("Done");
