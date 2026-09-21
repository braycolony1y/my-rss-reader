import test from 'node:test';
import assert from 'node:assert/strict';
import * as cheerio from 'cheerio/slim';
import MacStoriesSource from '../src/sources/MacStoriesSource.js';
import { createArticleParser } from '../src/articles/parser.js';
import { createArticlePipeline } from '../src/articles/pipeline.js';
import { cleanArticleMarkup } from '../src/articles/markup.js';

const url = 'https://www.macstories.net/stories/review/';
const fixture = `<html><article class="featured-post">Unrelated story</article><article class="post"><header><h1>Review</h1><a rel="author">Writer</a></header>
<div class="post-content"><p>${'Introduction. '.repeat(30)}</p><aside class="aside-narrow">Supported By Sponsor</aside>
<h3>Why local AI?</h3><p>Middle of the review.</p><div class="media-wrapper"><img src="https://cdn.macstories.net/photo.png"><p class="image-caption">A useful caption.</p></div>
<aside class="info-box">Important testing caveat.</aside>
<div class="ms-widget"><style>.mx:has(input:checked) .value {display:block}</style><div class="mx-part" id="benchmarks"><h2>Benchmarks</h2>
<figure class="mx"><h3>Prompt processing</h3><input type="radio" id="large" name="size" checked><label for="large">256K prompt</label><svg viewBox="0 0 100 100"><text>123 TPS</text></svg><p class="value">All benchmark data</p><script>bad()</script></figure></div></div>
<h3>Conclusion</h3><p>Final conclusions remain present.</p></div><footer>Author promotion</footer></article></html>`;

test('MacStories retains the whole body, captions, caveats and isolated interactive panels', async () => {
    const parser = createArticleParser({ updateArticleFetchProgress() {}, recordArticleFetchOutcome: async () => {} });
    const result = await parser.parseArticleHtmlContent(fixture, url, 'opencli-fetch', [], ['opencli-fetch']);
    const $ = cheerio.load(cleanArticleMarkup(result.content));
    assert.equal(result.title, 'Review');
    assert.equal(result.author, 'Writer');
    assert.equal(result.interactivePanelCount, 1);
    assert.match($.text(), /Middle of the review/);
    assert.match($.text(), /Important testing caveat/);
    assert.match($.text(), /Final conclusions remain present/);
    assert.doesNotMatch($.text(), /Unrelated story|Supported By|Author promotion/);
    assert.equal($('img').length, 1);
    assert.equal($('iframe').length, 1);
    assert.equal($('iframe').attr('sandbox'), '');
    const embedded = cheerio.load($('iframe').attr('srcdoc'));
    assert.equal(embedded('input[type="radio"]').length, 1);
    assert.equal(embedded('svg').length, 1);
    assert.match(embedded('style').text(), /:has\(input:checked\)/);
    assert.match(embedded.text(), /All benchmark data/);
    assert.equal(embedded('script').length, 0);
    assert.equal(new MacStoriesSource().isUsableArticleResult(result), true);
    assert.equal(new MacStoriesSource().isUsableArticleResult({ content: '<p>Only an introduction</p>' }), false);
});

test('Techmeme fetches MacStories through native HTML before abbreviated text readers', async () => {
    const methods = [];
    const pipeline = createArticlePipeline({
        getArticleFetchPolicy: async () => ({ strategyOrder: ['jina', 'opencli-fetch'], availableStrategies: ['jina', 'opencli-fetch'] }),
        fetchArticleHtmlByStrategy: async strategy => { methods.push(strategy); return fixture; },
        fetchViaJina: async () => { throw new Error('Should not select the abbreviated reader'); },
        parseArticleHtmlContent: async () => ({ content: `<article data-macstories-reader="1">${'Full body. '.repeat(60)}</article>` })
    });
    const result = await pipeline.expandArticleResultForSource('https://www.techmeme.com/260921/p39', {
        content: `<article class="techmeme-story" data-techmeme-story-id="260921p39" data-techmeme-main-url="${url}" data-techmeme-publisher="MacStories"><header class="techmeme-main-story"><h2><a href="${url}">Review</a></h2></header></article>`
    });
    assert.deepEqual(methods, ['opencli-fetch']);
    assert.equal(result.primaryArticleFetched, true);
});
