import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from 'cheerio';
import TinhteSource from '../src/sources/TinhteSource.js';
import { createArticleParser } from '../src/articles/parser.js';

const body = `<span class="xf-body-paragraph">Opening text.<br><br></span>
<div class="LinkExpander"><div class="LinkExpander_Ratio" style="padding-bottom:56.25%"><span data-s9e-mediaembed="youtube"><span style="padding-bottom:56.25%"><iframe src="https://www.youtube.com/embed/example" style="height:100%;position:absolute"></iframe></span></span></div></div>
<span class="xf-body-paragraph"><br><br></span><h2>Robot and TV</h2>
<span class="bdImage_attachImage" style="width:2048px"><span class="inner" style="padding-bottom:66%"><img src="https://tinhte.vn/appforo/index.php?attachments/123/data&amp;oauth_token=expired" data-permalink="https://photo2.tinhte.vn/photo.jpg" data-src="https://tinhte.vn/expired"></span></span><br>
<h2>Gaming monitors</h2><p>${'Story text. '.repeat(30)}</p>`;

test('Tinhte permanent images, video sizing and section navigation survive the full parser', async () => {
    const parser = createArticleParser({ updateArticleFetchProgress() {}, recordArticleFetchOutcome() {} });
    const html = `<html><title>Example</title><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({post:{post_body_html:body,poster_username:'Author'}})}</script></html>`;
    const result = await parser.parseArticleHtmlContent(html, 'https://tinhte.vn/thread/example.123/', 'direct');
    const $ = load(result.content);
    assert.equal($('img').attr('src'), 'https://photo2.tinhte.vn/photo.jpg');
    assert.doesNotMatch(result.content, /oauth_token|padding-bottom|position:absolute/);
    assert.equal($('iframe').length, 1);
    assert.match($('iframe').attr('style'), /aspect-ratio:16\/9/);
    assert.equal($('.tinhte-quick-view strong').text(), 'Xem nhanh');
    assert.equal($('.tinhte-quick-view a').length, 2);
    $('.tinhte-quick-view a').each((_, a) => assert.equal($($(a).attr('href')).length, 1));
    assert.equal(result.author, 'Author');
});

test('Tinhte repairs old cached markup without duplicating navigation or wrappers', () => {
    const source = new TinhteSource();
    const once = source.enhanceArticleResult({content:body});
    assert.equal(source.enhanceArticleResult(once).content, once.content);
    assert.doesNotMatch(once.content, /oauth_token|padding-bottom/);
});

test('Tinhte galleries retain image sources rather than lightbox page links', () => {
    const source = new TinhteSource();
    const content = source.normalizeContent('<ul class="Tinhte_Galleria"><li><a href="https://tinhte.vn/misc/lightbox"><img src="https://photo2.tinhte.vn/gallery.jpg"></a></li></ul>');
    const $ = load(content);
    assert.equal($('img').attr('src'), 'https://photo2.tinhte.vn/gallery.jpg');
    assert.doesNotMatch(content, /misc\/lightbox/);
});
