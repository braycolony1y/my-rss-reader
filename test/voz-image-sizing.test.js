import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from 'cheerio';
import VozSource from '../src/sources/VozSource.js';
import { preserveVozWrapperImageWidths } from '../src/articles/voz-image-sizing.js';
import { escapePostText, renderVozPost } from '../src/articles/voz-post-renderer.js';
import { extractBalancedElementByClass, cleanArticleMarkup } from '../src/articles/markup.js';
import { cleanVozCachedContent } from '../src/sources/voz-cached-content.js';
import { renderArchive } from '../src/board/presentation.js';

const url = 'https://voz.vn/t/openai-tiep-tuc-lo-nang.1297823/page-2';
// Post 44335467: the image is 1254px square, displayed at 100px by its wrapper.
const quote = `<blockquote><div class="bbCodeBlock-title">Công lý cho gao đỏ đã nói:</div>
<div class="bbCodeBlock-content"><div class="bbImageWrapper lazyload" style="width: 100px">
<img class="bbImage lazyload" src="data:image/svg+xml,%3Csvg width='1254' height='1254'%3E" data-src="https://i.imgur.com/G2Ym1om.png" width="1254" height="1254">
</div> Lời tđn được , không hiểu bọn này nó lời kiểu gì luôn</div></blockquote>`;

test('VOZ parser retains wrapper display width through responsive cleanup and sanitization', () => {
    const raw = `<article class="message message--post" data-content="post-44335467" data-author="Techs.Review"><div class="bbWrapper">${quote}<br>Reply outside quote</div></article>`;
    const output = new VozSource().parseArticleHtmlContent(raw, url, {}, { escapeHtml: escapePostText, extractBalancedElementByClass });
    const $ = load(cleanArticleMarkup(output));
    assert.equal($('.voz-post-body img').attr('width'), '100');
    assert.equal($('.voz-post-body img').attr('height'), undefined);
    assert.equal($('.voz-post-body img').attr('src'), 'https://i.imgur.com/G2Ym1om.png');
    assert.match($('.voz-post-body').text(), /Reply outside quote/);
    assert.match($('blockquote').text(), /Lời tđn được/);
});

test('responsive cleanup retains only safe VOZ image widths', () => {
    const output = cleanArticleMarkup('<div class="voz-post"><img width="100" height="1254" src="https://example.com/small.png"><img width="99999" src="https://example.com/large.png"></div><img width="100" src="https://example.com/article.png">');
    const $ = load(output);
    assert.equal($('.voz-post img').first().attr('width'), '100');
    assert.equal($('.voz-post img').last().attr('width'), undefined);
    assert.equal($('img').last().attr('width'), undefined);
});

test('archive renderer and cached markup preserve an available wrapper width', () => {
    const output = renderVozPost({ post_id: '44335467', permalink: url }, { body: quote });
    assert.equal(load(output)('.voz-post-body img').attr('width'), '100');
    assert.equal(load(cleanVozCachedContent(quote))('img').attr('width'), '100');
});

test('existing archives recover lost sizing from the original post without changing other images', () => {
    const original = quote + '<img src="https://example.com/photo.jpg" width="800">';
    const display = load(original, null, false);
    display('.bbImageWrapper').removeAttr('style');
    display('.bbImage').removeAttr('width').removeAttr('data-src').attr('src', 'https://i.imgur.com/G2Ym1om.png');
    const output = renderArchive({ url, thread_id: 'voz.vn:thread:1297823', posts: {
        '44335467': { post_id: '44335467', permalink: url, current_content: original, display_content: display.html() }
    } });
    const $ = load(output);
    assert.equal($('.bbImage').attr('width'), '100');
    assert.equal($('img[src="https://example.com/photo.jpg"]').attr('width'), '800');
});

test('wrapper sizing rejects non-pixel widths and keeps unrelated full-size images unchanged', () => {
    for (const style of ['width: 100%', 'width: -1px', 'width: 99999px', 'width: calc(100px)', 'height:100px']) {
        const markup = `<div class="bbImageWrapper" style="${style}"><img src="https://example.com/photo.jpg" width="1254"></div>`;
        assert.equal(preserveVozWrapperImageWidths(markup), markup);
    }
    const markup = '<div style="width:100px"><img width="1254"></div><span class="bbImageWrapper"><img width="1254"></span>';
    assert.equal(preserveVozWrapperImageWidths(markup), markup);
    const sized = preserveVozWrapperImageWidths('<div class="bbImageWrapper" style="width:100px"><img style="width:200px" width="1254"></div>');
    assert.equal(load(sized)('img').attr('width'), '100');
    assert.equal(load(sized)('img').attr('style'), 'width: 100px');
});
