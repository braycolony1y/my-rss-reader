const targetUrl = 'https://cdnphoto.dantri.com.vn/k-19qNENWePnabXqNI90pWqGgqQ=/2026/07/20/trang-trai-lon-cropped-1784503499823.jpg';
const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Referer': new URL(targetUrl).origin + '/',
    'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
};
const res1 = await fetch(targetUrl, { headers });
console.log('Direct:', res1.status);

const cfProxy = 'https://rss-proxy.k1d.workers.dev/?url=';
const res2 = await fetch(cfProxy + encodeURIComponent(targetUrl), { headers });
console.log('CF Proxy:', res2.status);
