import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from 'cheerio';
import { sanitizePostMarkup } from '../src/articles/post-markup-sanitizer.js';
import { cleanVozCachedContent } from '../src/sources/voz-cached-content.js';
import { normalizeCachedYoutubeEmbeds } from '../src/articles/youtube-cached-embeds.js';

const originalSandbox = 'allow-scripts allow-same-origin allow-popups allow-presentation';
const youtubeSandbox = originalSandbox + ' allow-popups-to-escape-sandbox';
const video = 'https://www.youtube.com/embed/AQ7-f2epAz8?wmode=opaque&enablejsapi=1&start=898';

for (const host of ['www.youtube.com', 'youtube.com', 'www.youtube-nocookie.com']) {
    test(`fresh and cached ${host} players open unrestricted watch tabs`, () => {
        const src = video.replace('www.youtube.com', host);
        const input = `<div class="voz-post" data-absolute-post-id="44262757"><iframe src="${src}" sandbox="${originalSandbox}" srcdoc="unsafe" allowfullscreen="true"></iframe></div>`;
        for (const result of [sanitizePostMarkup(input), cleanVozCachedContent(input)]) {
            const $ = load(result);
            assert.equal($('iframe').attr('sandbox'), youtubeSandbox);
            assert.equal($('iframe').attr('src'), src);
            assert.equal($('iframe').attr('srcdoc'), undefined);
            assert.equal($('iframe').attr('allowfullscreen'), 'true');
            assert.equal($('[data-absolute-post-id="44262757"]').length, 1);
            assert.equal(normalizeCachedYoutubeEmbeds(result), result, 'migration is idempotent');
        }
    });
}

test('the YouTube permission does not extend to other providers or deceptive hosts', () => {
    const providers = ['player.vimeo.com', 'www.tiktok.com', 'www.instagram.com', 'platform.twitter.com', 'www.reddit.com'];
    for (const host of providers) {
        const markup = `<iframe src="https://${host}/embed/test" sandbox="allow-top-navigation allow-popups-to-escape-sandbox"></iframe>`;
        assert.equal(load(sanitizePostMarkup(markup))('iframe').attr('sandbox'), originalSandbox);
        assert.equal(normalizeCachedYoutubeEmbeds(markup), markup);
    }
    for (const src of ['https://youtube.com.evil.test/embed/test', 'https://notyoutube.com/embed/test', 'http://www.youtube.com/embed/test', 'javascript:alert(1)']) {
        const markup = `<iframe src="${src}"></iframe>`;
        assert.equal(load(sanitizePostMarkup(markup))('iframe').length, 0);
        assert.equal(normalizeCachedYoutubeEmbeds(markup), markup);
    }
});

test('cached post numbering and playback settings survive the YouTube migration', () => {
    const markup = `<div class="voz-post" id="voz-post-44262757" data-post-index="44262757" data-absolute-post-id="44262757"><a class="voz-post-index">#44262757</a><iframe src="${video}" sandbox="${originalSandbox}" style="aspect-ratio:560/315" loading="lazy"></iframe></div>`;
    const result = cleanVozCachedContent(markup, { pagination: { currentPage: 2 } });
    const $ = load(result);
    assert.equal($('.voz-post').attr('data-post-index'), '21');
    assert.equal($('.voz-post-index').text(), '#21');
    assert.equal($('iframe').attr('src'), video);
    assert.equal($('iframe').attr('style'), 'aspect-ratio:560/315');
    assert.equal($('iframe').attr('loading'), 'lazy');
    assert.equal($('iframe').attr('sandbox'), youtubeSandbox);
    assert.equal(cleanVozCachedContent(result, { pagination: { currentPage: 2 } }), result);
});
