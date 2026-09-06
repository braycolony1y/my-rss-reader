import assert from 'node:assert/strict';
import test from 'node:test';
import TienPhongSource, { extractTienPhongPrimaryVideo } from '../src/sources/TienPhongSource.js';

const pageUrl = 'https://tienphong.vn/example-post123.tpo';
const streamUrl = 'https://cdn.tienphong.vn/videos/example/1080.mp4.m3u8';
const posterUrl = 'https://cdn.tienphong.vn/images/example.jpg.webp';

const shortVideoHtml = `
    <body class="shortvideo-detail">
        <div class="short-video-wrapper">
            <div class="content video-player">
                <video autoplay poster="${posterUrl}">
                    <source src="${streamUrl}" type="application/x-mpegURL">
                </video>
                <span class="name">Như Ý - Diễm Linh</span>
            </div>
        </div>
    </body>`;

test('extracts the primary HLS stream from a Tiền Phong short-video article', () => {
    assert.deepEqual(extractTienPhongPrimaryVideo(shortVideoHtml, pageUrl), {
        url: streamUrl,
        poster: posterUrl,
        title: ''
    });
});

test('renders Tiền Phong short-video pages as one playable article video', () => {
    const result = { title: 'Video title' };
    const source = new TienPhongSource();
    const content = source.parseArticleHtmlContent(shortVideoHtml, pageUrl, result, {
        escapeHtml: value => String(value)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
    });

    assert.equal(result.author, 'Như Ý - Diễm Linh');
    assert.equal(result.videoUrl, streamUrl);
    assert.equal(result.videoPoster, posterUrl);
    assert.match(content, /<video\b[^>]*controls[^>]*playsinline[^>]*preload="metadata"/i);
    assert.match(content, /src="https:\/\/cdn\.tienphong\.vn\/videos\/example\/1080\.mp4\.m3u8"/i);
    assert.doesNotMatch(content, /autoplay/i);
});

test('keeps the first playable video when Tiền Phong falls back to Jina Reader', () => {
    const source = new TienPhongSource();
    const parsed = source.parseJinaReaderText(`
[Video 41](${streamUrl})

[Video 42](https://cdn.tienphong.vn/videos/related/1080.mp4)
    `);

    assert.equal(parsed.readerType, 'video-article');
    assert.equal(parsed.markdown, `[Video 41](${streamUrl})`);
});

test('rejects unrelated recommendation cards mistakenly returned as the requested article', () => {
    const source = new TienPhongSource();
    const url = 'https://tienphong.vn/sieu-mau-noi-y-bi-mang-khap-mang-xa-hoi-post1874068.tpo';
    const content = '<p><img src="https://cdn.tienphong.vn/greenland.jpg"></p><h3><a href="https://tienphong.vn/greenland-post1874059.tpo">Liên minh châu Âu dựng lá chắn Greenland</a></h3>';
    assert.equal(source.isUsableArticleResult({ title: 'Siêu mẫu nội y bị mắng khắp mạng xã hội', content }, { url }), false);
    assert.equal(source.isUsableArticleResult({ content: '<p>' + 'This is the actual article prose. '.repeat(10) + '</p>' + content }, { url }), true);
});

test('the real Tiền Phong response restores the requested headline and body', async () => {
    const { readFileSync } = await import('node:fs');
    const html = readFileSync(new URL('./fixtures/tienphong-1874068.html', import.meta.url), 'utf8');
    const source = new TienPhongSource();
    const result = { title: 'Unrelated title' };
    const url = 'https://tienphong.vn/sieu-mau-noi-y-bi-mang-khap-mang-xa-hoi-post1874068.tpo';
    const content = source.parseArticleHtmlContent(html, url, result, { escapeHtml: String });
    assert.equal(result.title, 'Siêu mẫu nội y bị mắng khắp mạng xã hội');
    assert.match(content, /Lưu Văn/);
    assert.match(content, /Tỉnh Bách Nhiên/);
    assert.equal(source.isUsableArticleResult({ ...result, content }, { url }), true);
});


test('related story IDs containing 410 do not mark a real article as deleted', async () => {
    const { isDeletedArticlePayload } = await import('../src/article-source-state.js');
    const { readFileSync } = await import('node:fs');
    const html = readFileSync(new URL('./fixtures/tienphong-1874068.html', import.meta.url), 'utf8');
    assert.equal(isDeletedArticlePayload(pageUrl, html), false);
    assert.equal(isDeletedArticlePayload(pageUrl, '<h2 data-tracking="1874108"><a href="/post1874108.tpo">Another story</a></h2>'), false);
    assert.equal(isDeletedArticlePayload(pageUrl, '<h1>410 Gone</h1>'), true);
    assert.equal(isDeletedArticlePayload(pageUrl, '<h1>404 Not Found</h1>'), true);
});
