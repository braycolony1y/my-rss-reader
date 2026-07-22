import fs from 'fs';
import ZnewsSource from './src/sources/ZnewsSource.js';
const z = new ZnewsSource();
const url = 'https://znews.vn/messi-mach-trong-tai-cucurella-che-mieng-post1670785.html';

async function fetchFn(u) {
    const res = await fetch(u);
    return res;
}

z.getBestImage(url, fetchFn, null, {
    CF_PROXY_BASE: 'http://localhost/',
    extractImageFromHtml: (html) => null,
    isInvalidImage: (i) => false
}).then(console.log);
