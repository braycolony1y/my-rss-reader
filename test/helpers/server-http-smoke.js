import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createApplication } from '../../src/app.js';

const feedUrl = 'https://refactor.example/feed.xml';
const articleUrl = 'https://refactor.example/article-one';
const feed = { url: feedUrl, title: 'Fixture feed', category: 'World', fetchMethods: ['direct'] };
const article = { link: articleUrl, title: 'Fixture article', feedUrl, feedTitle: 'Fixture feed', feedCategory: 'World', pubDate: new Date().toISOString(), content: 'Fixture excerpt' };
const snapshot = Object.fromEntries(Object.entries({
    feeds: [feed], articles: [article], smartSources: [],
    smartClusters: [{ ...article, link: 'https://refactor.example/smart', smartCategory: 'news_world', clusterId: 'fixture-cluster', relatedArticles: [] }],
    smartRawArticles: [{ ...article, link: 'https://refactor.example/raw', title: 'Saved raw Smart article' }],
    savedStates: ['https://refactor.example/raw'], readStates: [], boardStates: [], hiddenStates: [],
    userPreferences: { clusteringModel: 'gemini-3.5-flash-lite' }, blockedArticleKeywords: []
}).map(([key, value]) => [key, JSON.stringify(value)]));
await fs.writeFile('database.json', JSON.stringify(snapshot));
const realFetch = globalThis.fetch;
let publisherRequests = 0;
globalThis.fetch = async (url, options) => {
    const target = String(url);
    if (target.startsWith('http://127.0.0.1:')) return realFetch(url, options);
    if (target === feedUrl) return new Response(`<?xml version="1.0"?><rss version="2.0"><channel><title>Fixture feed</title><item><title>Fixture article refreshed</title><link>${articleUrl}</link><description>Fixture feed excerpt</description><pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`);
    if (target.startsWith('https://refactor.example/')) {
        publisherRequests++;
        return new Response('<html><head><title>Fixture article</title></head><body><article><h1>Fixture article</h1><p>' + 'This is a substantive article paragraph used to exercise the complete reader pipeline and persistence. '.repeat(12) + '</p></article></body></html>');
    }
    throw new Error('Unexpected external request in isolated smoke test: ' + target);
};
const application = await createApplication();
const server = application.app.listen(0, '127.0.0.1');
await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
const base = 'http://127.0.0.1:' + server.address().port;
async function request(endpoint, { method = 'GET', body, authenticated = true } = {}) {
    const response = await realFetch(base + endpoint, { method, headers: { ...(authenticated ? { Cookie: 'auth=true' } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await response.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data, headers: response.headers };
}
try {
    assert.equal((await request('/health')).data.status, 'ok');
    const oversized = await request('/api/board-cache/folder', {method:'POST',body:{article:{link:articleUrl,content:'x'.repeat(110000)},folder:'cache'}});
    assert.equal(oversized.status,413);
    assert.match(oversized.headers.get('content-type'),/application\/json/);
    assert.match(oversized.data.error,/too large/);
    const folderSave = await request('/api/board-cache/folder',{method:'POST',body:{article,folder:'reading'}});
    assert.equal(folderSave.status,200);
    assert.ok(folderSave.data.boardStates.includes(articleUrl));
    assert.equal(folderSave.data.userPreferences.boardFolderMappings[articleUrl],'reading');
    await request('/api/user-preferences', { method: 'POST', body: { key: 'boardFolderMappings', value: {} } });
    await request('/api/user-preferences', { method: 'POST', body: { key: 'voz_last_read_post_fixture', value: { postId: '10' } } });
    const preservedFolder = await request('/api/board-cache/folder', {method:'POST', body:{article,folder:'reading'}});
    assert.equal(preservedFolder.data.userPreferences.boardFolderMappings[articleUrl], 'reading');
    assert.equal(preservedFolder.data.userPreferences.voz_last_read_post_fixture.postId, '10');
    await request('/api/board-cache/folder',{method:'POST',body:{article,folder:null}});

    assert.equal((await request('/api/data', { authenticated: false })).status, 401);
    assert.equal((await request('/api/login', { method: 'POST', body: { password: 'fixture-password' }, authenticated: false })).status, 200);
    assert.equal((await request('/api/login', { method: 'POST', body: { password: 'wrong' }, authenticated: false })).status, 401);
    assert.equal((await request('/api/data')).data.articles.length, 1);
    const saved = await request('/api/data?filterType=saved');
    assert.equal(saved.data.articles[0].title, 'Saved raw Smart article');
    assert.equal((await request('/api/data?filterType=smart')).data.articles.length, 1);
    assert.equal((await request('/api/smart-status')).status, 200);
    assert.equal((await request('/api/smart-settings')).status, 200);
    assert.equal((await request('/api/smart-sources')).status, 200);
    const readerPath = '/api/article-content?url=' + encodeURIComponent(articleUrl) + '&feedUrl=' + encodeURIComponent(feedUrl);
    const first = await request(readerPath);
    assert.equal(first.status, 200);
    assert.equal(first.data.fetchStrategy, 'direct');
    assert.match(first.data.content, /substantive article paragraph/);
    assert.equal(publisherRequests, 1);
    const second = await request(readerPath);
    assert.equal(second.data.cached, true);
    assert.equal(publisherRequests, 1, 'second request must use the same cache owner');
    assert.equal(application.progress.activeForegroundRequests, 0);
    assert.equal((await request('/api/article-content')).status, 400);
    assert.equal((await request('/api/board-cache', { authenticated: false })).status, 401);
    assert.deepEqual((await request('/api/board-cache')).data.rules, []);
    const ruleSave = await request('/api/board-cache/rules', { method: 'PUT', body: { rules: [{ keywords: ['whole phrase'], source: feedUrl, enabled: false }] } });
    assert.equal(ruleSave.status, 200);
    assert.deepEqual(ruleSave.data.rules[0].keywords, ['whole phrase']);
    assert.equal((await request('/api/board-cache/rules', { method: 'PUT', body: { rules: [{ keywords: [] }] } })).status, 400);
    assert.equal((await request('/api/board-cache/active', { method: 'POST', body: { url: articleUrl, active: false } })).status, 400);
    assert.equal((await request('/api/board-cache/folder', { method: 'POST', body: { article, folder: 'Research / notes' } })).status, 200);
    assert.equal((await request('/api/data?filterType=board&filterValue=Research%20%2F%20notes')).data.articles[0].link, articleUrl);
    assert.equal((await request('/api/board-cache/folder', { method: 'POST', body: { article, folder: null } })).status, 200);

    assert.equal((await request('/api/content-filter-settings', { method: 'POST', body: { keywords: ['fixture'] } })).data.ok, true);
    assert.deepEqual((await request('/api/content-filter-settings')).data.keywords, ['fixture']);
    assert.ok((await request('/api/content-filter-preview', { method: 'POST', body: { keywords: ['fixture'] } })).data.overallTotal >= 1);
    const refreshed = await request('/api/sync', { method: 'POST', body: { feedUrl, requestId: 'smoke-sync' } });
    assert.equal(refreshed.data.success, true);
    assert.deepEqual(refreshed.data.logs, []);
    assert.equal((await request('/api/sync-progress?id=smoke-sync')).data.done, true);
    assert.equal((await request('/api/sync-toggle', { method: 'POST' })).data.paused, true);
    assert.equal((await request('/api/sync-status')).data.paused, true);
    assert.equal((await request('/health')).data.syncPaused, true, 'health and routes share the sync owner');
    assert.equal((await request('/api/user-preferences', { method: 'POST', body: { key: 'smokePreference', value: 'persisted' } })).data.success, true);
    // Unavailable publishers remain ordinary history records: no early removal
    // and no extension beyond Recently Read's existing publication-date window.
    const retained = { ...article, link: 'https://refactor.example/deleted-recent', title: 'Original deleted headline', pubDate: new Date(Date.now() - 2 * 86400000).toISOString(), smartCategory: 'news_world' };
    const expired = { ...retained, link: 'https://refactor.example/deleted-expired', pubDate: new Date(Date.now() - 8 * 86400000).toISOString() };
    await application.database.env.RSS_DATA.putMany({
        smartRawArticles: JSON.stringify([retained, expired]),
        smartClusters: JSON.stringify([{ ...retained, clusterId: 'deleted-cluster', relatedArticles: [] }]),
        readStates: JSON.stringify([retained.link, expired.link]),
        unavailableSourceUrls: JSON.stringify([retained.link, expired.link]),
        blockedArticleKeywords: JSON.stringify(['never-match-retention-fixture-unique-token'])
    });
    const history = (await request('/api/data?filterType=recent')).data;
    assert.equal(history.articles.find(item => item.link === retained.link)?.title, retained.title);
    assert.equal(history.articles.some(item => item.link === expired.link), false);
    const smartWithDeleted = (await request('/api/data?filterType=smart&filterValue=news_world')).data;
    const unavailable = smartWithDeleted.articles.find(item => item.link === retained.link);
    assert.ok(unavailable, 'unavailable source must remain in its normal cluster');
    assert.equal(unavailable.sourceDeleted, true);
    assert.equal(unavailable.title, retained.title);
    assert.deepEqual(history.readStates, [retained.link, expired.link]);
    const disk = JSON.parse(await fs.readFile('database.json', 'utf8'));
    assert.equal(JSON.parse(disk.userPreferences).smokePreference, 'persisted');
    assert.ok(JSON.parse(disk.articles).some(item => item.title === 'Fixture article refreshed'));
    assert.equal((await request('/api/article-pdf', { method: 'POST', body: { url: articleUrl }, authenticated: false })).status, 401);
    assert.equal((await request('/api/article-pdf', { method: 'POST', body: { url: 'file:///etc/passwd' } })).status, 400);
    assert.equal((await request('/api/article-pdf/unknown')).status, 404);
    if (process.env.PDF_SMOKE === '1') {
        const started = await request('/api/article-pdf', { method: 'POST', body: { url: articleUrl, title: 'Complete fixture PDF', feedUrl } });
        assert.equal(started.status, 202);
        await application.pdf.whenIdle();
        const status = await request('/api/article-pdf/' + started.data.id);
        assert.equal(status.data.status, 'ready', status.data.error);
        const file = await realFetch(base + status.data.downloadUrl, { headers: { Cookie: 'auth=true' } });
        assert.equal(file.status, 200);
        assert.match(file.headers.get('content-disposition'), /attachment/);
        assert.equal(Buffer.from(await file.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
        assert.equal((await request('/api/article-pdf', { method: 'POST', body: { url: articleUrl } })).data.status, 'ready');
        console.log('PDF_HTTP_SMOKE_OK');
    }
    console.log('HTTP_SMOKE_OK: auth, feed/Smart data, saved raw Smart articles, reader, shared cache, filters, worker RSS sync, progress, shared pause state, persistence');
} finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
}
// The original parser-worker lifetime is process-owned; close this isolated host.
process.exit(0);
