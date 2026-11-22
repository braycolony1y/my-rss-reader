import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeHTML } from 'entities';
import VietnamplusSource, { trimVietnamplusMarkdown } from '../src/sources/VietnamplusSource.js';

function extractBalancedElementByClass(html, className) {
    const startRegex = new RegExp(`<([a-z][a-z0-9-]*)\\b[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>`, 'i');
    const start = startRegex.exec(html);
    if (!start) return '';
    const tagName = start[1];
    const contentStart = start.index + start[0].length;
    const tokens = new RegExp(`<\\/?${tagName}\\b[^>]*>`, 'gi');
    tokens.lastIndex = start.index;
    let depth = 0;
    let token;
    while ((token = tokens.exec(html))) {
        if (/^<\//.test(token[0])) {
            depth--;
            if (depth === 0) return html.slice(contentStart, token.index);
        } else if (!/\/>$/.test(token[0])) {
            depth++;
        }
    }
    return '';
}

test('VietnamPlus keeps the complete balanced article body after nested ad and related blocks', () => {
    const html = `<html><body>
        <div class="article__body zce-content-body cms-body">
            <div class="article__social">Share controls</div>
            <p>Đoạn một về vị trí và cường độ của bão số 5.</p>
            <p>Đoạn hai về hướng di chuyển trong ngày 2 tháng 9.</p>
            <div class="sda_middle"><div>Advertisement</div></div>
            <p>Đoạn ba về dự báo cho ngày 3 tháng 9.</p>
            <p>Đoạn bốn về gió mạnh và sóng cao trên biển.</p>
            <div class="article-relate"><article>
                <a href="/related.vnp" title="Tin bão liên quan"><img data-src="https://media.example/related.jpg"></a>
            </article></div>
            <p>Đoạn cuối về cảnh báo nắng nóng trên đất liền.</p>
            <div class="article__source">(TTXVN/Vietnam+)</div>
        </div>
        <div class="article__author">Tác giả</div>
    </body></html>`;
    const source = new VietnamplusSource();
    const content = source.parseArticleHtmlContent(html, 'https://www.vietnamplus.vn/example-post1.vnp', {}, {
        extractBalancedElementByClass
    });

    const decoded = decodeHTML(content);
    assert.match(decoded, /Đoạn một/);
    assert.match(decoded, /Đoạn hai/);
    assert.match(decoded, /Đoạn ba/);
    assert.match(decoded, /Đoạn bốn/);
    assert.match(decoded, /Đoạn cuối/);
    assert.match(decoded, /\(TTXVN\/Vietnam\+\)/);
    assert.doesNotMatch(decoded, /Share controls|Advertisement/);
    assert.match(decoded, /BÀI VIẾT LIÊN QUAN/);
    assert.match(decoded, /Tin bão liên quan/);
});

test('VietnamPlus rejects a trailing recommendation fragment as an article body', () => {
    const source = new VietnamplusSource();
    assert.equal(source.isUsableArticleResult({
        content: '<p><img src="https://media.example/nepal.jpg"></p><h3><a href="/other.vnp">Unrelated Nepal story</a></h3><p>30/08/2026 09:14</p><p>A short recommendation summary.</p>'
    }), false);
    assert.equal(source.isUsableArticleResult({
        content: Array.from({ length: 7 }, (_, index) => `<p>Complete weather report paragraph ${index + 1} ${'with detailed forecasting context '.repeat(5)}</p>`).join('')
    }), true);
});

test('VietnamPlus clean-reader Markdown stops before linked recommendation cards', () => {
    const cleaned = trimVietnamplusMarkdown(`
        Theo bản tin, bão số 5 đang di chuyển trên Biển Đông.

        ${'Nội dung dự báo chi tiết cho tàu thuyền và đất liền. '.repeat(20)}

        [![Ảnh bài liên quan](https://media.vietnamplus.vn/related.jpg)](https://www.vietnamplus.vn/bai-lien-quan-post123.vnp)
        ## [Bài liên quan không thuộc nội dung chính](https://www.vietnamplus.vn/bai-lien-quan-post123.vnp)

        (TTXVN/Vietnam+)

        ### [Tin cùng chuyên mục](https://www.vietnamplus.vn/moitruong/)
        More unrelated stories
    `);

    assert.match(cleaned, /Nội dung dự báo chi tiết/);
    assert.match(cleaned, /\(TTXVN\/Vietnam\+\)/);
    assert.doesNotMatch(cleaned, /Bài liên quan không thuộc|Tin cùng chuyên mục|More unrelated/);
});
