import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import TuoitreSource from '../src/sources/TuoitreSource.js';

const pageUrl = 'https://tuoitre.vn/current-event-story-1003.htm';
const articleHtml = `
    <meta property="article:published_time" content="2026-08-24T20:14:26&#x2B;07:00">
    <div class="detail-cmain clearfix">
        <div class="detail-content">
            <p>Nội dung bài viết.</p>
            <div class="VCSortableInPreviewMode alignCenter" type="content">
                <div placeholder="Nhập nội dung...">
                    <h2><span>Hải Sapa là ai?</span></h2>
                    <p>Hải Sapa tên thật Vũ Hoàng Hải.</p>
                    <p>Những nội dung này được phát triển dưới thương hiệu Sapa TV.</p>
                </div>
            </div>
        </div>
        <div class="readmore-body-box"></div>
    </div>
    <div class="detail__history">
        <h2 class="title-box">Dòng sự kiện:
            <a href="/chong-buon-lau-hang-gia-e1940.htm">Ch&#x1ED1;ng bu&#xF4;n l&#x1EAD;u, h&#xE0;ng gi&#x1EA3;</a>
        </h2>
        <div class="box-middle" data-box-thread="1940"></div>
    </div>`;

const threadHtml = `
    <div class="item"><a href="/story-one-1001.htm">Bài viết &amp; thứ nhất</a><p class="box-category-time">24/08</p></div>
    <div class="item"><a href="/story-two-1002.htm">Bài viết thứ hai</a><p class="box-category-time">23/08</p></div>
    <div class="item"><a href="/current-event-story-1003.htm">Bài viết hiện tại</a><p class="box-category-time">22/08</p></div>
    <div class="item"><a href="/story-four-1004.htm">Bài viết thứ tư</a><p class="box-category-time">21/08</p></div>
    <div class="item"><a href="/story-five-1005.htm">Bài viết thứ năm</a><p class="box-category-time">20/08</p></div>
    <div class="item"><a href="/story-six-1006.htm">Bài viết thứ sáu</a><p class="box-category-time">19/08</p></div>`;

const escapeHtml = value => String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

test('renders Tuổi Trẻ content callouts as dedicated liquid-glass cards', async () => {
    const source = new TuoitreSource();
    const content = await source.parseArticleHtmlContent(articleHtml, pageUrl, {}, {
        escapeHtml,
        fetchWithTimeout: async () => ({ ok: true, text: async () => threadHtml })
    });

    assert.match(content, /<aside class="tuoitre-info-card" role="note">/);
    assert.doesNotMatch(content, /tuoitre-info-card__badge|Hồ sơ nhân vật/);
    assert.ok(content.includes('<div class="tuoitre-info-card__content"><h2><span>Hải Sapa là ai?</span></h2>'));
    assert.match(content, /Hải Sapa tên thật Vũ Hoàng Hải\./);
    assert.doesNotMatch(content, /border-l-amber|bg-amber-50/);
});

test('hydrates the full Tuổi Trẻ event list while omitting the current article', async () => {
    const requests = [];
    const source = new TuoitreSource();
    const content = await source.parseArticleHtmlContent(articleHtml, pageUrl, {}, {
        escapeHtml,
        fetchWithTimeout: async (url, options, timeout) => {
            requests.push({ url, options, timeout });
            return { ok: true, text: async () => threadHtml };
        }
    });

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://tuoitre.vn/ajax/detailbox-thread/1940.htm');
    assert.equal(requests[0].timeout, 1200);
    assert.equal(requests[0].options.headers.Referer, pageUrl);
    assert.match(content, /class="tuoitre-event-stream"/);
    assert.ok(content.includes('<span class="tuoitre-event-stream__eyebrow">Dòng sự kiện</span>'));
    assert.ok(content.includes('<strong class="tuoitre-event-stream__title">Chống buôn lậu, hàng giả</strong>'));
    assert.equal((content.match(/class="tuoitre-event-stream__item"/g) || []).length, 5);
    assert.doesNotMatch(content, /Bài viết hiện tại/);
    assert.match(content, /Bài viết &amp; thứ nhất/);
    assert.match(content, /Bài viết thứ sáu/);
    assert.match(content, /class="tuoitre-event-stream__more">[\s\S]*?<span>Xem thêm<\/span>/);
    assert.match(content, /<svg width="24" height="24"/);
});

test('keeps the event heading usable when the optional list request times out', async () => {
    const source = new TuoitreSource();
    const content = await source.parseArticleHtmlContent(articleHtml, pageUrl, {}, {
        escapeHtml,
        fetchWithTimeout: async () => { throw new Error('timed out'); }
    });

    assert.match(content, /class="tuoitre-event-stream"/);
    assert.match(content, /Chống buôn lậu, hàng giả/);
    assert.doesNotMatch(content, /tuoitre-event-stream__list/);
});

test('defines responsive liquid-glass light styles for Tuổi Trẻ editorial sections', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');

    assert.match(html, /\.theme-glass-light \.article-rendered-content \.tuoitre-info-card,/);
    assert.match(html, /backdrop-filter: blur\(28px\) saturate\(170%\)/);
    assert.match(html, /Restrained neutral palette for Tuổi Trẻ glass sections/);
    assert.doesNotMatch(html, /\.tuoitre-info-card::after/);
    assert.doesNotMatch(html, /\.tuoitre-info-card__badge/);
    assert.match(html, /\.tuoitre-event-stream__eyebrow \{[\s\S]*?color: #64748b !important;/);
    assert.match(html, /\.tuoitre-event-stream__more \{[\s\S]*?color: #475569 !important;[\s\S]*?border-color: rgba\(148, 163, 184, 0\.24\);/);
    assert.match(html, /\.theme-glass-light \.article-rendered-content \.tuoitre-event-stream__title \{/);
    assert.match(html, /\.tuoitre-event-stream__title \{[\s\S]*?white-space: normal;/);
    assert.match(html, /@media \(max-width: 640px\) \{[\s\S]*?\.tuoitre-event-stream__header \{/);
    assert.match(server, /\$\('aside'\)\.not\('\.tuoitre-info-card'\)\.remove\(\)/);
    assert.match(server, /node\.closest\('\.tuoitre-event-stream, \.embedded-suggested-articles'\)\.length > 0/);
});
