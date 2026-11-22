import test from 'node:test';
import assert from 'node:assert/strict';
import DantriSource from '../src/sources/DantriSource.js';

const articleUrl = 'https://dantri.com.vn/the-gioi/example-20260827102624313.htm';
const slug = '1-khoanh-khac-lu-quet-ap-xuong-cua-khau-trung-quoc-nepal-1787793941729';
const legacyMp4 = `/2026/08/27/${slug}.mp4`;
const hlsUrl = `https://vcdn.dantri.com.vn/vod/2026/08/27/${slug}/playlist.m3u8`;
const poster = 'https://cdnphoto.dantri.com.vn/example/poster.gif';

function fixtureHtml() {
    return `
        <main data-slot="content">
            <p>Article text long enough to represent the story body.</p>
            <figure class="video">
                <video data-src="${legacyMp4}" poster="${poster}" data-video-id="202040"></video>
                <figcaption><p>Lũ quét nuốt chửng cửa khẩu Trung Quốc - Nepal (Video: X)</p></figcaption>
            </figure>
        </main>`;
}

test('Dantri uses its structured HLS stream instead of the legacy 404 MP4 path', () => {
    const source = new DantriSource();
    const result = {
        videos: [{
            url: hlsUrl,
            poster,
            title: 'Lũ quét nuốt chửng cửa khẩu Trung Quốc - Nepal'
        }]
    };

    const content = source.parseArticleHtmlContent(fixtureHtml(), articleUrl, result, {});

    assert.match(content, new RegExp(hlsUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(content, new RegExp(`vcdn\\.dantri\\.com\\.vn${legacyMp4.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.match(content, /controls/i);
    assert.match(content, /playsinline/i);
    assert.match(content, /preload="metadata"/i);
    assert.match(content, /Lũ quét nuốt chửng cửa khẩu Trung Quốc - Nepal/);
});

test('Dantri derives the HLS path when structured video metadata is unavailable', () => {
    const source = new DantriSource();
    const content = source.parseArticleHtmlContent(fixtureHtml(), articleUrl, {}, {});

    assert.match(content, new RegExp(hlsUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(content, /vcdn\.dantri\.com\.vn\/2026\/08\/27\/[^"']+\.mp4/i);
});
