import test from 'node:test';
import assert from 'node:assert/strict';
import {
    deletedSourceKind,
    hasGenericDeletedSourceMarker,
    isDeletedArticlePayload,
    normalizeArticleSourceUrl
} from '../src/article-source-state.js';

test('recognizes publisher deletion pages without matching ordinary article prose', () => {
    const deleted = `
        <html><head><title>Không tìm thấy đường dẫn này</title></head>
        <body><h1>Không tìm thấy đường dẫn này.</h1>
        <p>Bạn có thể truy cập vào trang chủ hoặc sử dụng ô dưới đây để tìm kiếm</p></body></html>`;
    const article = '<html><title>Bài viết bình thường</title><article><p>Không tìm thấy lý do để trì hoãn dự án.</p></article></html>';

    assert.equal(hasGenericDeletedSourceMarker(deleted), true);
    assert.equal(hasGenericDeletedSourceMarker(article), false);
    assert.equal(isDeletedArticlePayload('https://tienphong.vn/story.tpo', deleted), true);
});

test('recognizes terminal HTTP status markers and keeps VOZ thread semantics', () => {
    assert.equal(hasGenericDeletedSourceMarker('<!-- RSS_SOURCE_HTTP_STATUS:410 --><html></html>'), true);
    assert.equal(isDeletedArticlePayload(
        'https://voz.vn/t/example.123/unread',
        'The requested thread could not be found.'
    ), true);
    assert.equal(deletedSourceKind('https://voz.vn/t/example.123/unread'), 'thread');
    assert.equal(deletedSourceKind('https://example.com/story'), 'article');
});

test('normalizes copied publisher links with trailing markdown punctuation', () => {
    assert.equal(
        normalizeArticleSourceUrl('https://tienphong.vn/story-post1870739.tpo)'),
        'https://tienphong.vn/story-post1870739.tpo'
    );
    assert.equal(
        normalizeArticleSourceUrl('https://kenh14.vn/story.chn\\]'),
        'https://kenh14.vn/story.chn'
    );
    assert.equal(
        normalizeArticleSourceUrl('https://example.com/wiki/Story_(2026)'),
        'https://example.com/wiki/Story_(2026)'
    );
});
