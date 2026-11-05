import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const read = name => readFileSync(new URL(`../public/js/${name}.js`, import.meta.url), 'utf8');

test('reader cleanup follows the actual hide barrier and cannot clear a reopened reader', () => {
    let changed;
    const root = {isConnected: true, style: {display: 'flex'}};
    const document = {querySelector: () => root, body: {style: {overflow: 'hidden'}}};
    const lifecycle = vm.runInNewContext(read('article/overlay-lifecycle') + ';ReaderOverlayLifecycle', {
        document, ReaderPrefetchLifecycle: {cancel() {}}, ReaderOverlayRequest: {cancel() {}},
        MutationObserver: class {constructor(callback) {changed = callback;} observe() {} disconnect() {}},
        clearInterval() {}, cancelAnimationFrame() {}
    });
    const app = {articleOverlayOpen: true, overlayContent: 'Visible article', overlayArticle: {title: 'A'},
        __readerOwner: Object.freeze({}),
        articleOverlayStack: [], releaseArticleReaderSession() {}, stopArticleSpeech() {},
        setArticleCopyState() {}, clearArticleRoute() {}};
    lifecycle.close(app);
    assert.equal(app.overlayContent, 'Visible article');
    assert.equal(app.articleOverlayClosing, true);
    assert.equal(document.body.style.overflow, 'hidden');
    const obsolete = changed;
    lifecycle.cancel(new Proxy(app, {}));
    app.articleOverlayOpen = true;
    app.overlayContent = 'New reader';
    root.style.display = 'none';
    obsolete();
    assert.equal(app.overlayContent, 'New reader');
    root.style.display = 'flex';
    lifecycle.close(app);
    root.style.display = 'none'; changed();
    assert.equal(app.overlayContent, null);
    assert.equal(app.articleOverlayClosing, false);
    assert.equal(document.body.style.overflow, '');
});

test('overlapping history changes cannot reopen an obsolete article after its list completes', async () => {
    const location = {hash: '#old'}, pending = [], opened = [];
    const routes = {'#old': {type: 'feed', value: 'old', articleUrl: 'https://example.test/old'},
        '#new': {type: 'feed', value: 'new', articleUrl: ''}};
    const transition = vm.runInNewContext(read('article/route-transition') + ';ReaderRouteTransition', {window: {location}});
    const app = {selectedFilterType: 'feed', selectedFilterValue: 'start', hideTooltip() {},
        getFilterFromHash: () => routes[location.hash], fetchData: () => new Promise(resolve => pending.push(resolve)),
        openArticleFromRoute: url => opened.push(url)};
    const old = transition.apply(app);
    location.hash = '#new'; const current = transition.apply(app);
    pending[1](); await current;
    pending[0](); await old;
    assert.deepEqual(opened, []);
    assert.equal(app.selectedFilterValue, 'new');
});

test('foreground publications reuse unique rows while applying authoritative order and field removal', () => {
    const publication = vm.runInNewContext(read('feeds/list-publication') + ';ReaderListPublication');
    const a = {link: 'a', oldImage: 'removed'}, b = {link: 'b'}, removed = {link: 'removed'};
    const result = publication.reconcile([a, b, removed], [{link: 'b', title: 'Updated'}, {link: 'a'}]);
    assert.strictEqual(result[0], b); assert.strictEqual(result[1], a);
    assert.equal(result[0].title, 'Updated'); assert.equal('oldImage' in result[1], false);
    assert.equal(result.length, 2);
    const ambiguous = publication.reconcile([a, a], [{link: 'a'}]);
    assert.notStrictEqual(ambiguous[0], a);
    const app = {articles: result, selectedFilterType: 'feed', selectedFilterValue: 'one', __readerOwner: Object.freeze({})};
    publication.commit(app); assert.equal(publication.retains(new Proxy(app, {})), true);
    app.selectedFilterValue = 'two'; assert.equal(publication.retains(app), false);
});

test('a cache-clear response cannot reopen a reader closed or replaced while the request was pending', async () => {
    let deliver, generation = 1, opened = 0;
    const refresh = vm.runInNewContext(read('article/cache-refresh') + ';ReaderOverlayCacheRefresh', {
        ReaderOverlayLifecycle: {generation: () => generation},
        fetch: () => new Promise(resolve => {deliver = resolve;})
    });
    const app = {articleOverlayOpen: true, overlayFetchedFromCache: true,
        overlayArticle: {link: 'a'}, articleReaderUrl: article => article?.link,
        articleContentCache: new Map([['a', {}]]), openArticleOverlay() {opened++;}};
    const pending = refresh.run(app);
    generation++; app.articleOverlayOpen = false; app.overlayArticle = null;
    deliver({ok: true, json: async () => ({})}); await pending;
    assert.equal(opened, 0); assert.equal(app.articleContentCache.has('a'), false);
});

test('opening an external Reddit target leaves the current reader transport intact', async () => {
    let cancellations = 0, opened = 0;
    const methods = vm.runInNewContext(read('article/overlay') + ';ReaderArticleOverlay.create()', {
        ReaderPrefetchLifecycle: {cancel() {}}, ReaderOverlayLifecycle: {cancel() {cancellations++;}},
        window: {open() {opened++;}}
    });
    const app = {isRedditArticle: () => true, articleReaderUrl: article => article.link, markAsReadExplicit() {}};
    await methods.openArticleOverlay.call(app, {link: 'https://reddit.com/r/test'});
    assert.equal(cancellations, 0); assert.equal(opened, 1);
});

test('reselecting the same section preserves rows while retaining refresh, page reset, and scroll-to-top behavior', () => {
    const location = {hash: '#feed/one?article=old'}, scroller = {scrollTo(x, y) {this.top = y;}};
    const transition = vm.runInNewContext(read('feeds/filter-transition') + ';ReaderFilterTransition', {
        window: {location}, document: {getElementById: () => scroller}
    });
    let requests = 0;
    const articles = [{link: 'a'}];
    const app = {selectedFilterType: 'feed', selectedFilterValue: 'one', currentPage: 3, articles,
        hideTooltip() {}, syncUserPreferenceDebounced() {}, fetchData() {requests++;}};
    transition.set(app, 'feed', 'one');
    assert.strictEqual(app.articles, articles); assert.equal(app.currentPage, 1);
    assert.equal(scroller.top, 0); assert.equal(requests, 1); assert.equal(location.hash, 'feed/one');
});
