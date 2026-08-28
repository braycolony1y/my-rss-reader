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
