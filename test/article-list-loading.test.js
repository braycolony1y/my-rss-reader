import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';

const script = readFileSync(new URL('../script.js', import.meta.url), 'utf8');

test('switching feeds cancels the obsolete download and keeps only the newest article list', async t => {
    const dom = new JSDOM('<body></body>', {url: 'https://reader.test/', runScripts: 'outside-only'});
    t.after(() => dom.window.close());
    dom.window.fetch = async () => ({ok: true, json: async () => ({})});
    dom.window.eval(script);
    const app = dom.window.rssApp();
    app.selectedFilterType = 'feed';
    app.selectedFilterValue = 'first';
    app.saveState = () => {};
    app.scheduleBriefingRefresh = () => {};
    app.hideTooltip = () => {};
    app.prefetchArticlesList = () => {};
    const requests = [];
    dom.window.fetch = (url, {signal}) => new Promise((resolve, reject) => {
        requests.push({url, signal, resolve});
        signal.addEventListener('abort', () => reject(new dom.window.DOMException('Cancelled', 'AbortError')));
    });
    const first = app.fetchData();
    assert.equal(requests.length, 1);
    app.selectedFilterValue = 'second';
    const second = app.fetchData();
    assert.equal(requests[0].signal.aborted, true);
    requests[1].resolve({ok: true, json: async () => ({articles: [{link: 'https://example.com/new', title: 'Newest list'}]})});
    await Promise.all([first, second]);
    assert.equal(app.articles.length, 1);
    assert.equal(app.articles[0].title, 'Newest list');
    assert.equal(app.isLoadingArticles, false);
    assert.equal(app._articleListAbort, null);
});
