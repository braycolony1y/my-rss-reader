import assert from 'node:assert/strict';
import test from 'node:test';
import Kenh14Source from '../src/sources/Kenh14Source.js';

function extractBalancedElementByClass(html, className) {
    const start = new RegExp(`<div\\b[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>`, 'i').exec(html);
    if (!start) return '';
    const contentStart = start.index + start[0].length;
    const tokenPattern = /<\/?div\b[^>]*>/gi;
    tokenPattern.lastIndex = start.index;
    let depth = 0;
    let token;
    while ((token = tokenPattern.exec(html))) {
        if (/^<\//.test(token[0])) {
            depth--;
            if (depth === 0) return html.slice(contentStart, token.index);
        } else {
            depth++;
        }
    }
    return '';
}

test('Kenh14 parser removes the in-article advertising label without truncating prose', async () => {
    const source = new Kenh14Source();
    const content = await source.parseArticleHtmlContent(`
        <div class="detail-content">
            <p>Đoạn nội dung trước vị trí quảng cáo.</p>
            <div class="ad-label">Quảng cáo</div>
            <p>Đoạn nội dung tiếp tục sau vị trí quảng cáo.</p>
        </div>
    `, 'https://kenh14.vn/example.chn', {}, {
        extractBalancedElementByClass
    });

    assert.match(content, /Đoạn nội dung trước vị trí quảng cáo/);
    assert.match(content, /Đoạn nội dung tiếp tục sau vị trí quảng cáo/);
    assert.doesNotMatch(content, />\s*Quảng cáo\s*</i);
});
