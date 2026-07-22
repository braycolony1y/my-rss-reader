import VozSource from './src/sources/VozSource.js';
const voz = new VozSource();
const fetchFn = (u) => fetch(u);
const utils = {
  fetchWithCookies: async () => '',
  CF_PROXY_BASE: 'https://rss-proxy.k1d.workers.dev/?url=',
  isInvalidImage: () => false,
  extractImageFromHtml: () => null
};
voz.getBestImage('https://voz.vn/t/thai-lan-tinh-cho-cong-chuc-khoang-40-tuoi-nghi-huu-som-de-tinh-gian-bo-may.1261865', fetchFn, null, utils).then(console.log).catch(console.error);
