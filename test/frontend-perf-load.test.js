import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('CDN scripts are pinned to exact versions and hls.js is not render-blocking', () => {
    const html = read('index.html');
    const cdn = [...html.matchAll(/<script[^>]+src="(https:\/\/cdn\.jsdelivr\.net\/[^"]+)"/g)].map(match => match[1]);
    assert.ok(cdn.length >= 2);
    for (const url of cdn) assert.match(url, /@\d+\.\d+\.\d+\//, `${url} must pin an exact version`);
    assert.doesNotMatch(html, /hls\.js/);
});

test('hls.js loads lazily, once, and only for .m3u8 videos', async () => {
    const src = read('public/js/article/overlay.js');
    const appended = [];
    const video = (srcValue) => ({
        getAttribute: name => name === 'src' ? srcValue : null,
        querySelector: () => null, querySelectorAll: () => [], removeAttribute() {}, canPlayType: () => '',
    });
    const videos = [video('https://cdn.example/stream.m3u8')];
    const document = {
        head: {appendChild: script => { appended.push(script); }},
        createElement: () => ({}),
        querySelectorAll: () => videos,
    };
    const window = {};
    const Reader = vm.runInNewContext(`${src};ReaderArticleOverlay`, {window, document, console});
    const app = Reader.create();
    // No video: nothing is loaded.
    videos.splice(0);
    app.attachHlsVideos();
    assert.equal(appended.length, 0);
    // An HLS video loads the library once.
    videos.push(video('https://cdn.example/stream.m3u8'));
    app.attachHlsVideos(); app.attachHlsVideos();
    assert.equal(appended.length, 1);
    assert.match(appended[0].src, /hls\.js@\d+\.\d+\.\d+\//);
    let attached = 0;
    window.Hls = class { static isSupported() { return true; } loadSource() {} attachMedia() { attached++; } };
    appended[0].onload();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(attached, 2);
});

test('saveState coalesces bursts while saveStateNow and hidden pages persist immediately', () => {
    const src = read('public/js/app/persistence.js');
    const timers = [];
    const document = {visibilityState: 'visible'};
    const window = {setTimeout: fn => timers.push(fn) && timers.length, clearTimeout: () => { timers.length = 0; }};
    const Persistence = vm.runInNewContext(`${src};ReaderAppPersistence`, {window, document, sessionStorage: {}, localStorage: {}});
    let persisted = 0;
    const app = Persistence.create();
    app.persistStateNow = () => { persisted++; };
    app.saveState(); app.saveState(); app.saveState();
    assert.equal(timers.length, 1);
    assert.equal(persisted, 0);
    app.saveStateNow();
    assert.equal(persisted, 1);
    assert.equal(timers.length, 0);
    document.visibilityState = 'hidden';
    app.saveState();
    assert.equal(persisted, 2);
});

test('timers that only refresh visible UI skip hidden tabs', () => {
    const src = read('public/js/app/bootstrap.js');
    assert.match(src, /if \(document\.hidden\) return; this\.clockNow = Date\.now\(\)/);
    assert.match(src, /if \(!document\.hidden\) this\.loadCacheState\(\)/);
});
