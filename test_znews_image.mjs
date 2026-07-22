import ZnewsSource from './src/sources/ZnewsSource.js';
import utils from './src/utils.js';

const source = new ZnewsSource();
const targetUrl = 'https://znews.vn/nang-cap-quan-trong-tren-iphone-18-pro-max-post1670290.html';

async function fetchFn(url) {
    const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    return res;
}

source.getBestImage(targetUrl, fetchFn, 'fallback.jpg', utils).then(console.log).catch(console.error);
