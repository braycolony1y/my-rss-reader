(async () => {
  const ZnewsSource = (await import('./src/sources/ZnewsSource.js')).default;
  const source = new ZnewsSource();
  const fetchFn = async (url) => {
     return await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }});
  };
  const utils = {
    CF_PROXY_BASE: 'https://rss-proxy.k1d.workers.dev/?url=',
    extractImageFromHtml: (h) => null,
    isInvalidImage: () => false
  };
  const img = await source.getBestImage('https://znews.vn/nang-cap-quan-trong-tren-iphone-18-pro-max-post1670290.html', fetchFn, null, utils);
  console.log("Image with proxy:", img);
})();
