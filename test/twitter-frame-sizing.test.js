import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const source = readFileSync(new URL('../public/js/article/twitter-frame-sizing.js', import.meta.url), 'utf8');

function fixture(t) {
    const dom = new JSDOM(`<div class="voz-twitter-embed" data-tweet-id="2118529317567439035"><iframe class="voz-twitter-embed__fallback" src="https://platform.twitter.com/embed/Tweet.html?id=2118529317567439035"></iframe></div>`, {
        url: 'https://reader.example/', runScripts: 'outside-only'
    });
    t.after(() => dom.window.close());
    const view = dom.window;
    view.eval(source + '\nwindow.installSizing = ReaderTwitterFrameSizing.install; window.installSizing(window);');
    const frame = view.document.querySelector('iframe');
    const send = (height, overrides = {}) => view.dispatchEvent(new view.MessageEvent('message', {
        origin: 'https://platform.twitter.com', source: frame.contentWindow,
        data: { 'twttr.embed': { method: 'twttr.private.resize', params: [{ height, data: { tweet_id: '2118529317567439035' } }] } },
        ...overrides
    }));
    return { view, frame, send };
}

test('direct X fallback follows content height, including expansion and responsive changes', t => {
    const { frame, send } = fixture(t);
    send(538);
    assert.equal(frame.style.height, '538px');
    assert.equal(frame.style.getPropertyPriority('height'), 'important');
    send(1800.5);
    assert.equal(frame.style.height, '1801px');
    send(620);
    assert.equal(frame.style.height, '620px');
});

test('X sizing rejects messages from another origin or browsing context', t => {
    const { view, frame, send } = fixture(t);
    send(538, { origin: 'https://untrusted.example' });
    send(538, { source: view });
    send(538, { source: null });
    assert.equal(frame.style.height, '');
});

test('X sizing rejects malformed, nonpositive, and excessive heights', t => {
    const { frame, send } = fixture(t);
    for (const height of [null, '538', -1, 0, NaN, Infinity, 100001]) send(height);
    send(538, { data: null });
    send(538, { data: { 'twttr.embed': { method: 'twttr.private.rendered' } } });
    assert.equal(frame.style.height, '');
});

test('X sizing requires matching tweet identity and the official frame URL', t => {
    const { frame, send } = fixture(t);
    frame.parentElement.dataset.tweetId = '12345';
    send(538);
    assert.equal(frame.style.height, '');
    frame.parentElement.dataset.tweetId = '2118529317567439035';
    frame.src = 'https://untrusted.example/embed/Tweet.html?id=2118529317567439035';
    send(538);
    assert.equal(frame.style.height, '');
});

test('removed fallbacks and official widget frames are left alone', t => {
    const { frame, send } = fixture(t);
    frame.className = 'twitter-tweet-rendered';
    send(538);
    assert.equal(frame.style.height, '');
    frame.className = 'voz-twitter-embed__fallback';
    frame.remove();
    send(538);
    assert.equal(frame.style.height, '');
});

test('installing for multiple reader instances keeps one message listener', t => {
    const { view, frame, send } = fixture(t);
    let writes = 0;
    const original = frame.style.setProperty.bind(frame.style);
    frame.style.setProperty = (...args) => { writes++; return original(...args); };
    view.installSizing(view);
    view.installSizing(view);
    send(538);
    assert.equal(writes, 1);
});
