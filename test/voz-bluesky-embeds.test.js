import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { load } from 'cheerio';
import { transformVozBlueskyEmbeds } from '../src/sources/voz-bluesky-embeds.js';
import { cleanVozCachedContent } from '../src/sources/voz-cached-content.js';
import { renderVozPost } from '../src/articles/voz-post-renderer.js';
import { cleanArticleMarkup } from '../src/articles/markup.js';
import { renderArchive } from '../src/board/presentation.js';
import { readReaderClientSource } from './helpers/reader-source.js';

const key = 'fiverslooters9s.bsky.social/post/3mzmxi6asd227';
const url = `https://bsky.app/profile/${key}`;
const uri = 'at://did:plc:baq7tw7xyl53igv4tmgmjbao/app.bsky.feed.post/3mzmxi6asd227';
const raw = `<div class="bbOembed bbMediaJustifier" data-media-site-id="bluesky" data-media-key="${key}" data-id="${key}"><a href="https://bsky.app/profile/${encodeURIComponent(key)}">https://bsky.app/profile/${encodeURIComponent(key)}</a></div>`;
const post = { post_id: '44269395', current_visible_number: 55, author_name: 'backboard2340', permalink: 'https://voz.vn/t/example.1295697/post-44269395' };

test('VOZ post 55 becomes a canonical Bluesky embed through fresh and cached rendering', () => {
    const fresh = renderVozPost(post, { body: raw });
    const cached = cleanVozCachedContent(`<div class="voz-post" data-absolute-post-id="44269395" data-post-index="55">${raw}</div>`, { pagination: { currentPage: 3 } });
    for (const html of [fresh, cleanArticleMarkup(fresh), cached, cleanArticleMarkup(cached)]) {
        const $ = load(html);
        assert.equal($('.voz-bluesky-embed').attr('data-bluesky-url'), url);
        assert.equal($('.voz-bluesky-embed__fallback').attr('href'), url);
        assert.equal($('.bbOembed').length, 0);
        assert.equal($('.voz-post').attr('data-post-index'), '55');
    }
});

test('stored VOZ archive bodies are upgraded at the rendering boundary', () => {
    const html = renderArchive({ url: 'https://voz.vn/t/example.1295697', posts: { 44269395: { ...post, current_content: raw, versions: [] } } });
    assert.match(html, /data-bluesky-url="https:\/\/bsky.app\/profile\//);
});

test('Bluesky transformation is idempotent, preserves neighbours, and accepts encoded media keys', () => {
    const input = `<p>before</p>${raw}<p>after</p>`;
    const transformed = transformVozBlueskyEmbeds(input);
    assert.equal(transformVozBlueskyEmbeds(transformed), transformed);
    assert.match(transformed, /^<p>before<\/p>/);
    assert.match(transformed, /<p>after<\/p>$/);
    const encoded = raw.replace(`data-media-key="${key}"`, `data-media-key="${encodeURIComponent(key)}"`);
    assert.match(transformVozBlueskyEmbeds(encoded), /class="voz-bluesky-embed"/);
    assert.equal(transformVozBlueskyEmbeds('<p>ordinary link</p>'), '<p>ordinary link</p>');
    for (const invalid of ['evil.example/../../post/abc', 'javascript:alert(1)', 'f.example/post/a" onload="x', '%GG']) {
        const input = raw.replaceAll(key, encodeURIComponent(invalid));
        assert.equal(transformVozBlueskyEmbeds(input), input);
    }
});

test('cached numbering repair still works alongside Bluesky migration', () => {
    const html = cleanVozCachedContent(`<div class="voz-post" data-post-index="44269395" data-absolute-post-id="44269395"><a class="voz-post-index">#44269395</a>${raw}</div>`, { pagination: { currentPage: 3 } });
    const $ = load(html);
    assert.equal($('.voz-post').attr('data-post-index'), '41');
    assert.equal($('.voz-post-index').text(), '#41');
    assert.equal($('.voz-bluesky-embed').length, 1);
});

function fixture(t, response = {}) {
    const dom = new JSDOM(transformVozBlueskyEmbeds(raw), { url: 'https://reader.example', runScripts: 'outside-only' });
    t.after(() => dom.window.close());
    const view = dom.window;
    let calls = 0;
    view.fetch = async input => {
        calls++;
        assert.equal(new URL(input).origin, 'https://embed.bsky.app');
        assert.equal(new URL(input).searchParams.get('url'), url);
        return { ok: true, json: async () => ({ html: `<blockquote data-bluesky-uri="${uri}"></blockquote><script>window.injected = true</script>` }), ...response };
    };
    view.eval(readFileSync(new URL('../public/js/article/bluesky-embeds.js', import.meta.url), 'utf8') + '\nwindow.embeds = ReaderBlueskyEmbeds;');
    return { view, embed: view.document.querySelector('.voz-bluesky-embed'), calls: () => calls };
}

test('client resolves a DID, renders only the official frame, and deduplicates hydration', async t => {
    const { view, embed, calls } = fixture(t);
    await Promise.all([view.embeds.hydrate(view.document, 'glass-light'), view.embeds.hydrate(view.document)]);
    const frame = embed.querySelector('iframe');
    assert.equal(calls(), 1);
    assert.equal(new URL(frame.src).pathname, '/embed/did:plc:baq7tw7xyl53igv4tmgmjbao/app.bsky.feed.post/3mzmxi6asd227');
    assert.equal(new URL(frame.src).searchParams.get('colorMode'), 'light');
    assert.equal(frame.getAttribute('scrolling'), 'no');
    assert.equal(frame.hasAttribute('allowfullscreen'), true);
    assert.equal(view.injected, undefined);
    assert.equal(embed.dataset.blueskyState, 'ready');
});

test('unavailable and mismatched Bluesky posts retain the working fallback', async t => {
    for (const response of [{ ok: false }, { json: async () => ({ html: `<blockquote data-bluesky-uri="${uri.replace('3mzmxi6asd227', 'other')}"></blockquote>` }) }]) {
        const { view, embed } = fixture(t, response);
        await view.embeds.hydrate(view.document);
        assert.equal(embed.dataset.blueskyState, 'fallback');
        assert.equal(embed.querySelector('iframe'), null);
        assert.equal(embed.querySelector('a').href, url);
    }
});

test('closing or replacing the article during lookup cannot append a stale player', async t => {
    const { view, embed } = fixture(t);
    const pending = view.embeds.hydrate(view.document);
    embed.remove();
    await pending;
    assert.equal(embed.querySelector('iframe'), null);
});

test('reader HTML replacements initialize new embeds after the initial hydration', async t => {
    const { view, calls } = fixture(t);
    await view.embeds.hydrate(view.document);
    view.document.body.innerHTML = transformVozBlueskyEmbeds(raw);
    // MutationObserver schedules the same asynchronous oEmbed lookup as open.
    await new Promise(resolve => setTimeout(resolve, 0));
    const embed = view.document.querySelector('.voz-bluesky-embed');
    assert.equal(embed.dataset.blueskyState, 'ready');
    assert.ok(embed.querySelector('iframe'));
    assert.equal(calls(), 2);
    view.document.body.appendChild(view.document.createElement('p'));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(calls(), 2);
});

test('VOZ clones of a loading placeholder own a new lookup instead of waiting for the removed node', async t => {
    const { view, embed, calls } = fixture(t);
    const pending = view.embeds.hydrate(view.document);
    const replacement = embed.cloneNode(true);
    assert.equal(replacement.dataset.blueskyState, 'loading');
    embed.replaceWith(replacement);
    await pending;
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(calls(), 2);
    assert.equal(embed.querySelector('iframe'), null);
    assert.equal(replacement.dataset.blueskyState, 'ready');
    assert.ok(replacement.querySelector('iframe'));
});

test('Bluesky sizing authenticates origin, frame, ID, and finite height', async t => {
    const { view, embed } = fixture(t);
    await view.embeds.hydrate(view.document);
    const frame = embed.querySelector('iframe');
    const send = (height, overrides = {}) => view.dispatchEvent(new view.MessageEvent('message', {
        origin: 'https://embed.bsky.app', source: frame.contentWindow,
        data: { id: frame.dataset.blueskyId, height }, ...overrides
    }));
    view.embeds.install(view);
    for (const height of [0, -1, Infinity, NaN, '600', 100001]) send(height);
    send(600, { origin: 'https://untrusted.example' });
    send(600, { source: view });
    send(600, { data: { id: 'different-frame', height: 600 } });
    assert.equal(frame.style.height, '');
    send(840.2);
    assert.equal(frame.style.height, '841px');
    send(480);
    assert.equal(frame.style.height, '480px');
    frame.src = 'https://untrusted.example';
    send(600);
    assert.equal(frame.style.height, '480px');
});

test('the composed reader calls Bluesky hydration before the X-only early return', () => {
    const source = readReaderClientSource();
    assert.match(source, /ReaderBlueskyEmbeds\.hydrate\(scope, this\.theme\);[\s\S]*if \(!embeds.length\) return/);
});
