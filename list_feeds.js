import { Miniflare } from 'miniflare';
const miniflare = new Miniflare({
    kvPersist: './kv-data',
    kvNamespaces: ['RSS_DATA'],
    script: 'addEventListener("fetch", () => {})',
    modules: true
});
(async () => {
    try {
        const RSS_DATA = await miniflare.getKVNamespace('RSS_DATA');
        const feeds = await RSS_DATA.get('feeds', {type: 'json'}) || [];
        const googleFeeds = feeds.filter(f => f.url && f.url.includes('news.google.com'));
        console.log(JSON.stringify(googleFeeds, null, 2));
    } catch(e) { console.error(e); }
    process.exit(0);
})();
