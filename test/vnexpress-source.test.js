import assert from 'node:assert/strict';
import test from 'node:test';
import VnexpressSource from '../src/sources/VnexpressSource.js';

test('VnExpress exposes its nested HLS player instead of leaving it hidden', () => {
    const source = new VnexpressSource();
    const content = source.parseArticleHtmlContent(`
        <article class="fck_detail">
            <p>Article introduction with enough information to represent the report.</p>
            <div id="embed_video_453413" style="display:none;">
                <div id="parser_player_453413" class="media_content" style="display:none;">
                    <video controls playsinline src="https://d1.vnecdn.net/video/master.m3u8"></video>
                </div>
            </div>
            <p>Article conclusion after the video player.</p>
        </article>
    `, 'https://vnexpress.net/example-5115303.html', {}, {});

    assert.match(content, /id="embed_video_453413" style=""/);
    assert.match(content, /id="parser_player_453413"[^>]*style=" display: block;"/);
    assert.match(content, /<video[^>]+src="https:\/\/d1\.vnecdn\.net\/video\/master\.m3u8"/);
    assert.doesNotMatch(content, /parser_player_453413[^>]+display:\s*none/i);
});

test('VnExpress rejects its generic homepage and recommendation-only fallback content', () => {
    const source = new VnexpressSource();
    const content = '<p>Liên hệ Tòa soạn Tải ứng dụng</p>' + '<h4><a href="https://vnexpress.net/other-5117168.html">Unrelated story</a></h4>'.repeat(5);
    const result = { title: 'VnExpress - Báo tiếng Việt nhiều người xem nhất', content };
    assert.equal(source.isUsableArticleResult(result), false);
    assert.equal(source.cleanCachedArticleContent(content, result), '');
    assert.equal(source.isUsableArticleResult({ title: 'Article title', content }), false);
    assert.equal(source.isUsableArticleResult({ title: 'Article title', content: '<p>' + 'Actual article body with substantial reporting. '.repeat(10) + '</p>' }), true);
    assert.equal(source.isUsableArticleResult({ sourceDeleted: true, sourceDeletedHasCache: false, content: 'Deleted article' }), true);
});

test('VnExpress 404 response is unavailable, not an article with the site headline', async () => {
    const { readFileSync } = await import('node:fs');
    const { isDeletedArticlePayload } = await import('../src/article-source-state.js');
    const html = readFileSync(new URL('./fixtures/vnexpress-missing-5117107.html', import.meta.url), 'utf8');
    assert.equal(isDeletedArticlePayload('https://vnexpress.net/article-5117107.html', html), true);
    assert.equal(new VnexpressSource().isUsableArticleResult({ content: html }), false);
});

test('VnExpress uses the article heading instead of a generic or unrelated title', () => {
    const result = { title: 'VnExpress - Báo tiếng Việt nhiều người xem nhất' };
    const content = new VnexpressSource().parseArticleHtmlContent('<h1 class="title-detail">Correct article headline</h1><article class="fck_detail"><p>Actual article body.</p></article>', 'https://vnexpress.net/article-1234567.html', result, {});
    assert.equal(result.title, 'Correct article headline');
    assert.match(content, /Actual article body/);
});
