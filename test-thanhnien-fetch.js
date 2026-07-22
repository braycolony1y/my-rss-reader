import fs from 'fs';
import { execSync } from 'child_process';
import ThanhNienSource from './src/sources/ThanhNienSource.js';

const fetchWithTimeout = (url, options, timeout) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(id));
};

async function run() {
    const url = 'https://thanhnien.vn/tong-thong-trump-cao-buoc-trung-quoc-can-thiep-bau-cu-my-185260717214639543.htm';
    const cmd = `curl -s "${url}" > tn_test2.html`;
    execSync(cmd);
    const html = fs.readFileSync('tn_test2.html', 'utf-8');

    const source = new ThanhNienSource();
    const result = {};
    const utils = { fetchWithTimeout };
    const output = await source.parseArticleHtmlContent(html, url, result, utils);
    console.log("Result:", result);
    fs.writeFileSync('tn_out2.html', output);
    console.log("Done. Check tn_out2.html for images.");
}
run();
