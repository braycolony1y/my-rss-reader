import test from 'node:test';
import assert from 'node:assert/strict';
import { getArticleThumbnail } from '../src/articles/thumbnail.js';
import { createClientArticlePreparer } from '../src/articles/client-preparer.js';

const url = 'https://voz.vn/t/story.1295082';
const inline = 'https://i.imgur.com/inline.gif';
const cover = 'https://voz.vn/attachments/screenshot-webp.123/';
const post = body => `<div class="voz-post"><div class="voz-post-body">${body}</div></div>`;
const photo = `<img src="${cover}" width="1220" height="1189">`;

for (const markup of [
    `<span class="voz-small-img-wrapper"><img class="voz-small-img" src="${inline}"></span>`,
    `<img src="${inline}" width="56" height="56">`,
    `<img src="https://voz.vn/proxy.php?image=${encodeURIComponent(inline)}&amp;hash=abc" width="56" height="56">`
]) {
    test(`VOZ cover skips inline image: ${markup}`, () => {
        const result = { content: post(markup + photo), image: inline };
        assert.equal(getArticleThumbnail(url, result), cover);
        assert.equal(getArticleThumbnail(url, { ...result,
            image: `https://voz.vn/proxy.php?image=${encodeURIComponent(inline)}&hash=abc` }), cover);
        assert.equal(getArticleThumbnail(url, { ...result, image: null }), cover);
    });
}

test('VOZ inline-only opener never uses an inline image or reply as its cover', () => {
    assert.equal(getArticleThumbnail(url, { image: inline,
        content: post(`<img src="${inline}" width="56" height="56">`) + post(photo) }), null);
});

test('VOZ preserves large GIFs, tall images, unknown dimensions, and valid existing covers', () => {
    for (const dimensions of ['width="600" height="400"', 'width="120" height="800"', '']) {
        assert.equal(getArticleThumbnail(url, {content: post(`<img src="${inline}" ${dimensions}>` + photo)}), inline);
    }
    assert.equal(getArticleThumbnail(url, {image: cover, content: post(photo)}), cover);
});

test('VOZ thumbnail repair avoids previously cached permanent redirects in client cards', async () => {
    const prepare = createClientArticlePreparer({getCachedThreadCreationTime: async () => null});
    const image = '/api/og-image?' + new URLSearchParams({url, rss: inline, icon: 'https://example.com/icon.png'});
    const article = {link: url + '/unread', title: 'Story', image};
    const prepared = await prepare(article);
    const parsed = new URL(prepared.image, 'http://reader.local');
    assert.equal(parsed.searchParams.get('cover'), '2');
    assert.equal(parsed.searchParams.get('rss'), inline);
    assert.equal(article.image, image);
    assert.equal((await prepare(prepared)).image, prepared.image);
    assert.equal((await prepare({...article, link: 'https://example.com/story'})).image, image);
});
