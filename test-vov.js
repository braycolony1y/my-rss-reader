import fs from 'fs';
import VovSource from './src/sources/VovSource.js';

const source = new VovSource();
const targetUrl = 'http://vov.vn/chinh-tri/da-nang-dieu-dong-bo-nhiem-nhieu-can-bo-chu-chot-post1317400.vov';

async function fetchFn(url) {
    const res = await fetch(url);
    return res;
}

const utils = {
    CF_PROXY_BASE: '', // Try without proxy first
    extractImageFromHtml: () => null,
    isInvalidImage: () => false
};

source.getBestImage(targetUrl, fetchFn, null, utils).then(img => console.log("Direct:", img));
