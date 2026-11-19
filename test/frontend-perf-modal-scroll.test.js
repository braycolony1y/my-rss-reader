import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('reader overlay does not run a full-viewport backdrop blur under the scrolling panel', () => {
    const overlay = read('public/components/article/overlay.html');
    const backdrop = overlay.match(/<div x-show="articleOverlayOpen"[^>]*class="article-overlay-backdrop[\s\S]*?<\/div>/)[0];
    assert.doesNotMatch(backdrop, /backdrop-blur/);
    // The blur now lives on two gutter strips that never sit under the panel.
    assert.match(overlay, /article-overlay-blur-strip/);
    const layout = read('public/styles/layout.css');
    assert.match(layout, /\.article-overlay-blur-strip\s*\{\s*display:\s*none;/);
    assert.match(layout, /width:\s*calc\(\(100% - min\(90%, 860px\)\) \/ 2\)/);
    assert.match(layout, /\.article-overlay-blur-strip\[data-side="left"\]/);
});

test('modal header and glass themes keep a single filter pass over the panel area', () => {
    assert.doesNotMatch(read('public/components/article/overlay-header.html'), /backdrop-blur-2xl/);
    const glass = read('public/styles/themes/surfaces.css');
    assert.doesNotMatch(glass, /\.theme-glass \.article-overlay-backdrop \{[^}]*blur\(12px\)/);
    assert.match(glass, /\.theme-glass \.article-overlay-panel \{[^}]*blur\(23px\)/);
    assert.match(read('public/styles/themes/light-surfaces.css'), /\.theme-glass-light \.article-overlay-blur-strip \{\s*display: none !important;/);
});

test('article content backdrop filters that cost a pass per scrolled frame stay disabled', () => {
    const layout = read('public/styles/layout.css');
    assert.match(layout, /#overlay-scroll-container \.ground-coverage[\s\S]*backdrop-filter: none !important/);
});

test('hideTooltip is a no-op on scroll events when no tooltip is pending', () => {
    const src = read('public/js/ui/tooltips.js');
    const module = vm.runInNewContext(`${src};ReaderUiTooltips`, {});
    const writes = [];
    const base = module.create();
    const app = new Proxy({...base}, {set(target, key, value) { writes.push(key); target[key] = value; return true; }});
    app.hideTooltip();
    assert.deepEqual(writes, []);
    app.customTooltipOpen = true;
    writes.length = 0;
    app.hideTooltip();
    assert.ok(writes.includes('customTooltipOpen'));
});

test('feed backdrop filters and glow blurs are dropped while the reader is open', () => {
    const layout = read('public/styles/layout.css');
    assert.match(layout, /html\[data-reader-open\] :is\(main, aside\) \*\s*\{[^}]*backdrop-filter: none !important/);
    assert.match(layout, /html\[data-reader-open\] \.card-ambient\s*\{\s*display: none !important/);
});

test('the reader-open flag is set after the fade-in and cleared immediately on close', () => {
    const src = read('public/js/app/bootstrap.js');
    const block = src.match(/let readerOpenTimer[\s\S]*?\n\s*\}\);\s*\n/)[0];
    const attrs = new Map();
    const timers = [];
    const root = {setAttribute: (k, v) => attrs.set(k, v), removeAttribute: k => attrs.delete(k)};
    const app = {articleOverlayOpen: false, $watch(key, fn) { this.cb = fn; }};
    const run = new Function('app', 'document', 'setTimeout', 'clearTimeout', `const self = app; (function () { ${block.replace(/this\./g, 'self.')} }).call(self);`);
    run(app, {documentElement: root}, fn => { timers.push(fn); return timers.length; }, () => {});
    app.articleOverlayOpen = true;
    app.cb(true);
    assert.equal(attrs.has('data-reader-open'), false);
    timers.shift()();
    assert.equal(attrs.has('data-reader-open'), true);
    app.articleOverlayOpen = false;
    app.cb(false);
    assert.equal(attrs.has('data-reader-open'), false);
});
