import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source = readFileSync(new URL('../public/js/article/prefetch-lifecycle.js', import.meta.url), 'utf8');
test('foreground cancellation releases speculative headers and bodies without cancelling another owner', {timeout: 3000}, async () => {
    const signals = [], cleared = [];
    const lifecycle = vm.runInNewContext(source + ';ReaderPrefetchLifecycle', {
        AbortController, clearTimeout: value => cleared.push(value),
        fetch: async (url, {signal, priority}) => {
            assert.equal(priority, 'low'); signals.push(signal);
            return {ok: true, json: () => new Promise((resolve, reject) => {
                signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {once: true});
            })};
        }
    });
    const app = {prefetchQueue: [1], hoverPrefetchTimeouts: {a: 2}, hoveredArticleUrl: 'a'}, other = {};
    const first = lifecycle.read(app, '/first').catch(error => error.name);
    const second = lifecycle.read(app, '/hover').catch(error => error.name);
    const third = lifecycle.read(other, '/other').catch(error => error.name);
    await new Promise(resolve => setImmediate(resolve));
    lifecycle.cancel(app);
    assert.equal(await first, 'AbortError'); assert.equal(await second, 'AbortError');
    assert.equal(signals[2].aborted, false);
    assert.equal(app.prefetchQueue.length, 0); assert.equal(app.hoveredArticleUrl, null);
    assert.deepEqual(cleared, [2]);
    lifecycle.cancel(other); assert.equal(await third, 'AbortError');
});
test('prefetch stays out of foreground loading and resumes with usable cached content afterward', async () => {
    let requests = 0;
    const result = {content: '<p>Cached</p>'};
    const lifecycle = vm.runInNewContext(source + ';ReaderPrefetchLifecycle', {
        AbortController, clearTimeout,
        fetch: async () => {requests++; return {ok: true, json: async () => result};}
    });
    const app = {isLoadingArticles: true};
    assert.equal(await lifecycle.read(app, '/article'), null);
    app.isLoadingArticles = false; app.articleOverlayOpen = app.isLoadingOverlay = true;
    assert.equal(await lifecycle.read(app, '/article'), null);
    app.isLoadingOverlay = false;
    assert.equal(await lifecycle.read(app, '/article'), result);
    assert.equal(requests, 1);
});
