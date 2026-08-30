import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeArticleMediaMarkup } from '../article-media.js';
import {
    preserveVozImageDisplayWidth,
    renderVozRedditEmbed,
    renderVozTwitterEmbed,
    transformVozRedditEmbeds
} from '../src/sources/VozSource.js';

test('VOZ image display width survives article media sanitization', () => {
    const forumImage = `<img src="data:image/svg+xml,%3Csvg width='500' height='500'%3E" data-src="https://i.imgur.com/example.png" class="bbImage lazyload" style="width: 100px" width="500" height="500">`;
    const preserved = preserveVozImageDisplayWidth(forumImage);
    const normalized = normalizeArticleMediaMarkup(preserved, 'https://voz.vn/t/example.1/');

    assert.match(preserved, /width="100"/);
    assert.doesNotMatch(preserved, /width="500"/);
    assert.match(preserved, /%3Csvg width='500' height='500'%3E/);
    assert.match(normalized, /width="100"/);
    assert.match(normalized, /height="500"/);
    assert.doesNotMatch(normalized, /style=/);
});

test('VOZ image width preservation ignores unsafe or non-pixel CSS widths', () => {
    const percentWidth = '<img src="https://example.com/a.png" style="width: 100%" width="500">';
    const excessiveWidth = '<img src="https://example.com/b.png" style="width: 99999px" width="500">';

    assert.equal(preserveVozImageDisplayWidth(percentWidth), percentWidth);
    assert.equal(preserveVozImageDisplayWidth(excessiveWidth), excessiveWidth);
});

test('VOZ X embeds use a self-sizing hook without a fixed 500px viewport', () => {
    const embed = renderVozTwitterEmbed('2092654567695736889');

    assert.match(embed, /class="voz-twitter-embed"/);
    assert.match(embed, /data-tweet-id="2092654567695736889"/);
    assert.match(embed, /scrolling="no"/);
    assert.doesNotMatch(embed, /height:\s*500px/);
    assert.equal(renderVozTwitterEmbed('not-a-tweet-id'), '');
});

test('VOZ Reddit oEmbeds become bounded official embeds with a compact fallback', () => {
    const embed = renderVozRedditEmbed('vozforums/comments/1w29ak0/t');

    assert.match(embed, /class="voz-reddit-embed"/);
    assert.match(embed, /src="https:\/\/embed\.reddit\.com\/r\/vozforums\/comments\/1w29ak0\/t\//);
    assert.match(embed, /href="https:\/\/www\.reddit\.com\/r\/vozforums\/comments\/1w29ak0\/t\//);
    assert.match(embed, /scrolling="no"/);
    assert.doesNotMatch(embed, /<svg\b/i);
    assert.equal(renderVozRedditEmbed('javascript:alert(1)'), '');
});

test('cached XenForo Reddit blocks are upgraded without retaining the giant logo', () => {
    const raw = `<div class="bbOembed bbMediaJustifier" data-provider="reddit" data-media-key="vozforums/comments/1w29ak0/t" data-media-site-id="reddit"><a href="https://www.reddit.com/r/vozforums/comments/1w29ak0/t"><i><svg viewBox="0 0 512 512"><path d="logo"></path></svg></i>Reddit</a></div>`;
    const transformed = transformVozRedditEmbeds(raw);

    assert.match(transformed, /class="voz-reddit-embed"/);
    assert.match(transformed, /data-reddit-post-id="1w29ak0"/);
    assert.doesNotMatch(transformed, /<svg\b|bbOembed|logo/i);
});

test('article reader hydrates X embeds and contains horizontal gestures', () => {
    const script = readFileSync(new URL('../script.js', import.meta.url), 'utf8');
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

    assert.match(script, /hydrateTwitterEmbeds\(root = document\)[\s\S]*twttr\.widgets\.createTweet/);
    assert.match(script, /tweetFrame\.setAttribute\('scrolling', 'no'\)/);
    assert.match(html, /#overlay-scroll-container\s*\{[^}]*overflow-x:\s*hidden;[^}]*overscroll-behavior-x:\s*none;[^}]*touch-action:\s*pan-y pinch-zoom;/);
    assert.doesNotMatch(html, /\.article-rendered-content\s*\{[^}]*overflow-x:\s*(?:clip|hidden);/);
    assert.match(html, /\.voz-reddit-embed__frame\s*\{[^}]*height:\s*760px\s*!important;/);
});
