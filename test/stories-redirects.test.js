import { readReaderClientSource } from './helpers/reader-source.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { registerDataRoutes } from '../src/routes/data-routes.js';

// Old Smart links (smart / top / classic modes) must open Stories without errors.
function reader(t, hash = '#smart/news_global') {
    const dom = new JSDOM('<body></body>', { url: `https://reader.test/${hash}`, runScripts: 'outside-only', pretendToBeVisual: true });
    dom.window.fetch = async () => ({ ok: true, json: async () => ({}) });
    dom.window.eval(readReaderClientSource());
    t.after(() => dom.window.close());
    const app = dom.window.rssApp();
    app.fetchData = async () => {};
    app.syncUserPreferenceDebounced = () => {};
    return { app, window: dom.window };
}

test('hashes that name the smart, top, classic or stories view all open Stories', t => {
    const { app, window } = reader(t);
    const cases = [
        ['#smart/news_vietnam', 'news_vietnam'],
        ['#top/news_vietnam', 'news_vietnam'],
        ['#classic/finance_global', 'finance_global'],
        ['#stories/tech_vietnam', 'tech_vietnam'],
        ['#TOP/news_global', 'news_global'],
        ['#smart/top/news_global', 'news_global'],
        ['#smart/news_global/classic', 'news_global'],
        ['#smart/news_vietnam?smartMode=top', 'news_vietnam'],
        ['#smart/finance_vietnam?mode=classic', 'finance_vietnam'],
        ['#smart/tech_world', 'tech_global']
    ];
    for (const [hash, destination] of cases) {
        window.location.hash = hash;
        const route = app.getFilterFromHash();
        assert.equal(route.type, 'smart', hash);
        assert.equal(route.value, destination, hash);
        assert.equal(route.articleUrl, '', hash);
    }
});

test('a legacy mode marker never swallows an article link', t => {
    const { app, window } = reader(t);
    window.location.hash = '#top/news_global?smartMode=top?article=' + encodeURIComponent('https://example.org/story');
    const route = app.getFilterFromHash();
    assert.deepEqual({ type: route.type, value: route.value, articleUrl: route.articleUrl }, { type: 'smart', value: 'news_global', articleUrl: 'https://example.org/story' });
});

test('a bare mode hash opens the default Stories section and other views are untouched', t => {
    const { app, window } = reader(t);
    window.location.hash = '#top';
    assert.deepEqual({ type: app.getFilterFromHash().type, value: app.getFilterFromHash().value }, { type: 'smart', value: null });
    window.location.hash = '#saved';
    assert.equal(app.getFilterFromHash().type, 'saved');
    window.location.hash = '#category/Tech%20News';
    assert.equal(app.getFilterFromHash().value, 'Tech News');
});

test('a stored top or classic smartTabModes preference is ignored and nothing mode related remains', async t => {
    for (const stored of ['top', 'classic']) {
        const { app, window } = reader(t);
        app.userPreferences = { smartTabModes: { __all: stored, news_global: stored } };
        app.setFilter('smart', 'news_vietnam');
        assert.equal(app.selectedFilterType, 'smart');
        assert.equal(app.selectedFilterValue, 'news_vietnam');
        assert.equal(window.location.hash, '#smart/news_vietnam');
        for (const name of ['smartTabMode', 'usesTopStories', 'setSmartTabMode', 'topStories', 'briefingFor']) assert.equal(name in app, false, name);
        assert.equal(app.headerTitle, 'Stories · News · Vietnam');
    }
});

test('the Stories label replaces Smart Briefing in the sidebar, navigation and source settings', () => {
    const read = file => readFileSync(new URL(`../public/components/${file}`, import.meta.url), 'utf8');
    const sidebar = read('sidebar.html'), navigation = read('smart/navigation.html');
    assert.match(sidebar, />Stories<\/span>/);
    assert.match(sidebar, /aria-label="Stories"/);
    assert.match(navigation, /aria-label="Stories sections"/);
    assert.match(navigation, />Stories<\/span>/);
    for (const [name, source] of Object.entries({ sidebar, navigation, sources: read('modals/smart-sources.html') })) {
        assert.doesNotMatch(source, /Smart\s+Briefing/i, name);
    }
    assert.doesNotMatch(navigation, /Top stories|setSmartTabMode/);
});

test('index.html early fetch no longer requests Top mode and understands old view names', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const script = html.match(/<script>\s*\/\/ Start the first Smart News request[\s\S]*?<\/script>/)[0].replace(/<\/?script>/g, '');
    assert.doesNotMatch(script, /smartMode\s*=\s*'top'/);
    const requests = [];
    for (const [hash, expected] of [['#top/news_vietnam', 'news_vietnam'], ['#classic/finance_global', 'finance_global'],
        ['#smart/tech_vietnam?smartMode=top', 'tech_vietnam'], ['#smart/top/news_global', 'news_global'], ['#smart', 'news_vietnam']]) {
        const window = { innerWidth: 1280, __rssInitialDataRequest: null };
        const context = { window, location: { hash }, document: { cookie: 'auth=true' }, sessionStorage: { getItem: () => null },
            localStorage: { getItem: () => null }, URLSearchParams, decodeURIComponent, fetch: url => { requests.push(String(url)); return Promise.resolve({ ok: true }); } };
        vm.runInNewContext(script, context);
        assert.equal(window.__rssInitialDataRequest?.filterValue, expected, hash);
    }
    assert.ok(requests.length === 5);
    assert.ok(requests.every(url => !url.includes('smartMode')), 'the early request never asks for Top mode');
});

test('the data route serves smart, stories, top and classic filter types from the same Stories handler', async () => {
    const handlers = {};
    const app = { get: (path, ...fns) => { handlers[path] = fns.at(-1); }, post() {} };
    const served = [];
    registerDataRoutes({ app, serveSmartData: async req => { served.push(req.query.filterType); }, env: { RSS_DATA: { get: async () => null } },
        prepareArticleForClient: async article => article, presentation: { _smartClustersHistory: {} } });
    const res = { setHeader() {}, json() {}, status() { return this; }, send() {}, type() { return this; } };
    for (const filterType of ['smart', 'stories', 'top', 'classic', 'TOP']) {
        await handlers['/api/data']({ query: { filterType, filterValue: 'news_global', smartMode: 'top', page: '1', limit: '10' }, body: {}, headers: {} }, res);
    }
    assert.deepEqual(served, ['smart', 'stories', 'top', 'classic', 'TOP']);
});
