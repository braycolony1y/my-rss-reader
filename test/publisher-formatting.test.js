import test from 'node:test';
import assert from 'node:assert/strict';
import YahooFinanceSource from '../src/sources/YahooFinanceSource.js';
import BBCSource from '../src/sources/BBCSource.js';
import AlJazeeraSource from '../src/sources/AlJazeeraSource.js';
import ApnewsSource from '../src/sources/ApnewsSource.js';

test('Yahoo removes stock widgets while retaining the following story and captions', () => {
    const result = new YahooFinanceSource().enhanceArticleResult({image: 'https://s.yimg.com/resizefill_h48/logo', content: '<p><a href="/author/ines">Ines</a> · Reporter</p><h4>Quote <a href="/quote/ABC">ABC</a></h4><p>Go deeper with AlphaSpace</p><p>4.7840 +0.0220 (+0.46%)</p><p>Story Continues</p><p>The report continues.</p><figure><img src="https://example.com/photo.jpg"><figcaption>News caption</figcaption></figure>'});
    assert.equal(result.author, 'Ines');
    assert.equal(result.image, 'https://example.com/photo.jpg');
    assert.match(result.content, /The report continues/);
    assert.match(result.content, /News caption/);
    assert.doesNotMatch(result.content, /AlphaSpace|Story Continues|4.7840/);
});

test('BBC extracts the byline, removes metadata controls and preserves captions', () => {
    const result = new BBCSource().enhanceArticleResult({author:'https://facebook.com/bbc',content:'<div data-block="byline"><span class="byline-link-text">Sean Coughlan</span></div><div data-block="metadata">Published yesterday</div><div data-block="text"><p>Story text.</p></div><img src="photo.jpg" alt="Image caption, A news photo">'});
    assert.equal(result.author, 'Sean Coughlan');
    assert.match(result.content, /<figcaption>A news photo/);
    assert.doesNotMatch(result.content, /Published yesterday|byline-link-text/);
});

test('Al Jazeera video pages preserve the publisher video embed and description', () => {
    const source = new AlJazeeraSource();
    const data = {'@type':'VideoObject', name:'Video story', embedUrl:'https://players.brightcove.net/123/default/index.html?videoId=456', description:'The report.'};
    const result = {};
    const html = source.parseArticleHtmlContent(`<script type="application/ld+json">${JSON.stringify(data)}</script>`, 'https://www.aljazeera.com/video/newsfeed/story', result);
    assert.match(html, /<iframe/);
    assert.match(html, /videoId=456/);
    assert.match(html, /The report/);
    assert.equal(result.title, 'Video story');
});

test('AP extracts the story body without a consent panel or video controls', async () => {
    const source = new ApnewsSource();
    const content = await source.parseArticleHtmlContent(`<div id="onetrust-consent-sdk">Cookie permission</div><div class="RichTextStoryBody"><p>${'Article reporting. '.repeat(35)}</p><div class="vjs-control-bar">Keyboard Shortcuts</div><p>Final paragraph.</p></div>`, 'https://apnews.com/article/test', {});
    assert.match(content, /Final paragraph/);
    assert.doesNotMatch(content, /Cookie permission|Keyboard Shortcuts/);
    assert.equal(source.isUsableArticleResult({content}), true);
});
