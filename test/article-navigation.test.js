import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function createReaderApp(hash = '#category/Forum') {
    const code = readFileSync(new URL('../script.js', import.meta.url), 'utf8');
    const storage = { getItem: () => null, setItem: () => {} };
    const location = { hash, pathname: '/', search: '' };
    const historyCalls = [];
    const updateLocation = (method, state, title, url) => {
        historyCalls.push({ method, url });
        location.hash = url.slice(url.indexOf('#'));
    };
    const history = {
        state: null,
        pushState: (...args) => updateLocation('push', ...args),
        replaceState: (...args) => updateLocation('replace', ...args)
    };
    const window = {
        innerWidth: 1200,
        location,
        history,
        speechSynthesis: { cancel() {}, getVoices: () => [] },
        addEventListener() {}
    };
    const document = {
        cookie: '',
        body: { style: {} },
        getElementById: () => null,
        addEventListener() {}
    };
    const context = {
        window,
        document,
        navigator: { maxTouchPoints: 0 },
        localStorage: storage,
        sessionStorage: storage,
        URL,
        URLSearchParams,
        console,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        fetch: async () => ({ ok: false }),
        performance: { now: () => 0 },
        requestAnimationFrame: callback => callback(),
        cancelAnimationFrame() {},
        confirm: () => false,
        alert() {}
    };

    vm.createContext(context);
    vm.runInContext(code, context);
    return { app: vm.runInContext('rssApp()', context), location, historyCalls };
}

test('article permalink appends one encoded source URL to the active category', () => {
    const { app, location, historyCalls } = createReaderApp();
    const article = { link: 'https://voz.vn/t/example.1273480/unread' };
    app.selectedFilterType = 'category';
    app.selectedFilterValue = 'Forum';

    app.updateArticleRoute(article);
    app.updateArticleRoute(article);

    assert.equal(location.hash, '#category/Forum?article=https%3A%2F%2Fvoz.vn%2Ft%2Fexample.1273480%2Funread');
    assert.equal((location.hash.match(/\?article=/g) || []).length, 1);
    assert.equal(historyCalls.length, 1);
    assert.deepEqual({ ...app.getFilterFromHash() }, {
        type: 'category',
        value: 'Forum',
        articleUrl: article.link
    });
});

test('article permalinks discard trailing copied punctuation', () => {
    const malformed = 'https://tienphong.vn/story-post1870739.tpo)';
    const { app, location } = createReaderApp(`#smart/news_vietnam?article=${encodeURIComponent(malformed)}`);

    assert.equal(
        app.articleRouteUrl(malformed),
        'https://tienphong.vn/story-post1870739.tpo'
    );
    assert.equal(
        app.getFilterFromHash().articleUrl,
        'https://tienphong.vn/story-post1870739.tpo'
    );

    app.selectedFilterType = 'smart';
    app.selectedFilterValue = 'news_vietnam';
    app.updateArticleRoute(malformed, true);
    assert.equal(
        location.hash,
        '#smart/news_vietnam?article=https%3A%2F%2Ftienphong.vn%2Fstory-post1870739.tpo'
    );
});

test('VOZ state variants count as one hidden article', () => {
    const { app } = createReaderApp();
    app.hiddenStates = [
        'https://voz.vn/t/example.1273480/unread',
        'https://voz.vn/t/example.1273480/post-123456',
        'https://voz.vn/t/example.1273480/page-2'
    ];

    assert.equal(app.hiddenArticleCount(), 1);
});
