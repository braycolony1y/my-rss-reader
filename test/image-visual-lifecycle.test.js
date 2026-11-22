import test from 'node:test';
import assert from 'node:assert/strict';
import { createImageVisualLifecycle } from '../public/image-visual-state.js';
import { updateStoryPhoto } from '../public/top-story-card/blend/source-readiness.js';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
    const attrs = { src: 'A' }, timers = new Map(), responses = [], paints = [];
    const img = { isConnected: true, dataset: {}, getAttribute: key => attrs[key] || '' };
    const state = { near: true }, states = new Map([[img, state]]);
    let sequence = 0, stopped = false;
    const lifecycle = createImageVisualLifecycle({
        win: { setTimeout: fn => { timers.set(++sequence, fn); return sequence; }, clearTimeout: id => timers.delete(id) },
        states, saved: new Map(), sourceOf: () => attrs.src, stopped: () => stopped,
        getFocus: () => new Promise(resolve => responses.push(resolve)),
        apply: (_, s) => paints.push({ ...s }),
    });
    return { attrs, img, state, states, responses, paints, update: () => lifecycle.update(img),
        timeout: () => [...timers.values()].forEach(fn => fn()), stop: () => { stopped = true; } };
}
const metadata = x => ({ x, y: .2, palette: { primary: [1, 2, 3] }, tint: { h1: 25 }, blend: { marker: x } });
test('late focus commits all metadata together after fallback while continuously visible', async () => {
    const f = fixture(); f.update(); f.timeout();
    assert.equal(f.state.focus.x, .5); assert.equal(f.state.settled, true);
    const result = metadata(.9); f.responses[0](result); await flush();
    const last = f.paints.at(-1);
    assert.equal(last.focus, result); assert.equal(last.palette, result.palette);
    assert.equal(last.tint, result.tint); assert.equal(last.blend, result.blend);
    assert.equal(last.deferred, null);
    assert.ok(f.paints.every(s => s.palette !== result.palette || s.focus === result));
});
test('identical assignments preserve the generation; sizes and srcset invalidate it', async () => {
    const f = fixture(); f.update(); const generation = f.state.generation;
    f.update(); assert.equal(f.state.generation, generation); assert.equal(f.responses.length, 1);
    f.attrs.sizes = '50vw'; f.update(); assert.equal(f.state.generation, generation + 1);
    f.responses[0](metadata(.1)); await flush(); assert.equal(f.state.focus.x, .5);
    f.attrs.srcset = 'B 2x'; f.update(); f.responses[1](metadata(.2)); await flush(); assert.equal(f.state.focus.x, .5);
    f.responses[2](metadata(.8)); await flush(); assert.equal(f.state.focus.x, .8);
});
test('A to B to A rejects the first A generation, and removal and stop ignore replies', async () => {
    for (const end of ['active', 'removed', 'stopped']) {
        const f = fixture(); f.update(); f.attrs.src = 'B'; f.update(); f.attrs.src = 'A'; f.update();
        f.responses[0](metadata(.1)); f.responses[1](metadata(.2)); await flush();
        assert.equal(f.state.focus.x, .5);
        if (end === 'removed') f.img.isConnected = false;
        if (end === 'stopped') f.stop();
        f.responses[2](metadata(.9)); await flush(); assert.equal(f.state.focus.x, end === 'active' ? .9 : .5);
    }
});
test('old decoded soft image cannot mark a replacement ready', async () => {
    const dom = new JSDOM('<img>'), soft = dom.window.document.querySelector('img');
    Object.defineProperties(soft, { complete: { value: true }, naturalWidth: { value: 100 } });
    const decodes = []; soft.decode = () => new Promise(resolve => decodes.push(resolve));
    let refreshes = 0; const refresh = () => refreshes++;
    assert.equal(updateStoryPhoto(soft, 'A', 'article-A', refresh), false);
    assert.equal(updateStoryPhoto(soft, 'B', 'article-B', refresh), false);
    decodes[0](); await flush(); assert.equal(refreshes, 0);
    decodes[1](); await flush(); assert.equal(refreshes, 1);
    assert.equal(updateStoryPhoto(soft, 'B', 'article-B', refresh), true);
    assert.equal(updateStoryPhoto(soft, 'B', 'article-C', refresh), false);
    soft.remove(); decodes[2](); await flush(); assert.equal(refreshes, 1); dom.window.close();
});
test('fallback attempts follow the current candidate and stop after default failure', () => {
    const context = vm.createContext({ URL });
    vm.runInContext(readFileSync('public/js/smart/image-fallback.js', 'utf8') + ';globalThis.next=ReaderStoryImageFallback.next', context);
    const app = { usesTopStories: true, proxyImageUrl: x => x };
    const img = { src: 'A', isConnected: true };
    const fail = article => context.next(app, { target: img }, article);
    fail({ image: 'A', imageCandidates: ['A2', 'A3'] }); assert.equal(img.src, 'A2');
    img.src = 'B'; const b = { image: 'B', imageCandidates: ['B2', 'B3'] };
    fail(b); assert.equal(img.src, 'B2'); fail(b); assert.equal(img.src, 'B3');
    fail(b); assert.equal(img.src, '/public/default.jpg'); fail(b); assert.equal(img.src, '/public/default.jpg');
    img.src = 'B'; fail(b); assert.equal(img.src, 'B2', 'a new successful primary can retry its own candidates');
    img.isConnected = false; fail(b); assert.equal(img.src, 'B2');
});

test('failed soft decode can recover on a later load without retrying on every layout', async () => {
    const dom = new JSDOM('<img>'), soft = dom.window.document.querySelector('img');
    Object.defineProperties(soft, { complete: { value: true }, naturalWidth: { value: 100 } });
    let calls = 0, refreshes = 0;
    soft.decode = () => ++calls === 1 ? Promise.reject(new Error('failed bytes')) : Promise.resolve();
    const refresh = () => refreshes++;
    assert.equal(updateStoryPhoto(soft, 'A', 'owner', refresh), false); await flush();
    assert.equal(updateStoryPhoto(soft, 'A', 'owner', refresh), false); assert.equal(calls, 1);
    soft.dispatchEvent(new dom.window.Event('load')); await flush();
    assert.equal(updateStoryPhoto(soft, 'A', 'owner', refresh), true); assert.equal(calls, 2); assert.equal(refreshes, 1);
    dom.window.close();
});
