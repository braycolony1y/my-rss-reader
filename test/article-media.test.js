import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeArticleMediaMarkup } from '../article-media.js';

test('normalizes lazy picture markup while keeping the image before its caption', () => {
    const html = `
        <figure class="tplCaption" style="width:1020px">
            <meta itemprop="url" content="https://cdn.example.com/fallback.jpg">
            <div class="fig-picture" style="padding-bottom:70%;position:relative">
                <picture>
                    <source data-srcset="https://cdn.example.com/photo.jpg?w=1020&amp;dpr=1 1x, https://cdn.example.com/photo.jpg?w=1020&amp;dpr=2 2x">
                    <img class="lazy" style="position:absolute" src="data:image/svg+xml,placeholder" data-src="https://cdn.example.com/photo.jpg?w=1020&amp;dpr=1" alt="Caption text">
                </picture>
            </div>
            <figcaption>Caption text</figcaption>
        </figure>`;

    const normalized = normalizeArticleMediaMarkup(html, 'https://publisher.example.com/article');
    assert.equal((normalized.match(/<img\b/gi) || []).length, 1);
    assert.ok(normalized.includes('https://cdn.example.com/photo.jpg?w=1020&amp;dpr=2'));
    assert.ok(normalized.indexOf('<img') < normalized.indexOf('<figcaption'));
    assert.doesNotMatch(normalized, /<picture\b|data-src|srcset=|position:\s*absolute|class="lazy"/i);
});

test('recovers an image from figure metadata when the lazy image is missing', () => {
    const normalized = normalizeArticleMediaMarkup(
        '<figure><meta itemprop="url" content="/image.jpg"><figcaption>Recovered caption</figcaption></figure>',
        'https://publisher.example.com/story'
    );
    assert.match(normalized, /<img[^>]+src="https:\/\/publisher\.example\.com\/image\.jpg"[^>]*>/i);
    assert.ok(normalized.indexOf('<img') < normalized.indexOf('<figcaption'));
});
