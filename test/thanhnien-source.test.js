import test from 'node:test';
import assert from 'node:assert/strict';
import ThanhNienSource, { extractThanhNienPrimaryVideo } from '../src/sources/ThanhNienSource.js';

const videoArticleHtml = `
<html>
    <meta property="og:title" content="HLV Hudson tự tin ngược dòng">
    <div class="video-focus iframe-resize vPlayer hidden">
        <div class="VCSortableInPreviewMode active dev" type="VideoStream"
            data-item-id="18526082513435768"
            data-vid="thanhnien.mediacdn.vn/325084952045817856/2026/8/25/hlv-hudson.mp4"
            data-thumb="https://thanhnien.mediacdn.vn/thumb_w/750/325084952045817856/2026/8/25/poster.jpeg"
            data-autoplay="true"></div>
    </div>
    <div class="detail-content"><p>Nội dung bài viết đủ dài để trình đọc giữ lại.</p><div data-check-position="body_end"></div>
</html>`;

test('extracts Thanh Nien primary video stored outside the article body', () => {
    assert.deepEqual(extractThanhNienPrimaryVideo(videoArticleHtml), {
        url: 'https://thanhnien.mediacdn.vn/325084952045817856/2026/8/25/hlv-hudson.mp4',
        poster: 'https://thanhnien.mediacdn.vn/thumb_w/750/325084952045817856/2026/8/25/poster.jpeg'
    });
});

test('adds the primary video metadata exactly once without preserving autoplay', async () => {
    const source = new ThanhNienSource();
    const result = { title: 'HLV Hudson tự tin ngược dòng' };

    const content = await source.parseArticleHtmlContent(
        videoArticleHtml,
        'https://thanhnien.vn/example.htm',
        result,
        {}
    );

    assert.match(content, /Nội dung bài viết/);
    assert.equal(result.videoUrl, 'https://thanhnien.mediacdn.vn/325084952045817856/2026/8/25/hlv-hudson.mp4');
    assert.equal(result.videoPoster, 'https://thanhnien.mediacdn.vn/thumb_w/750/325084952045817856/2026/8/25/poster.jpeg');
    assert.equal(result.videos.length, 1);
    assert.doesNotMatch(content, /autoplay/i);
});
