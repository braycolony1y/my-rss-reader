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

test('restores linked image and caption paragraphs as a semantic figure', () => {
    const normalized = normalizeArticleMediaMarkup(`
        <p><a href="https://publisher.example.com/gallery"><img src="https://cdn.example.com/photo.jpg" alt="News photo"></a></p>
        <p>News photo caption © Reuters</p>
    `, 'https://publisher.example.com/story');

    assert.match(normalized, /^\s*<figure class="article-media-figure">/);
    assert.match(normalized, /<a href="https:\/\/publisher\.example\.com\/gallery"><img[^>]+><\/a>/);
    assert.match(normalized, /<figcaption>News photo caption (?:©|&#xa9;) Reuters<\/figcaption>/);
});

test('adds extra-spacing classes only to likely charts and transparent graphics', () => {
    const normalized = normalizeArticleMediaMarkup(`
        <figure><img src="https://cdn.example.com/economy-chart.svg" alt="Quarterly GDP chart"><figcaption>Source: Statistics office</figcaption></figure>
        <p><img src="https://cdn.example.com/ordinary-photo.jpg" alt="A normal news photo"></p>
    `, 'https://publisher.example.com/story');

    assert.match(normalized, /<figure class="[^"]*article-media-figure[^"]*article-graphic-figure|<figure class="[^"]*article-graphic-figure[^"]*article-media-figure/);
    assert.match(normalized, /class="article-graphic-image"/);
    assert.doesNotMatch(normalized, /ordinary-photo\.jpg"[^>]*class="[^"]*article-graphic-image/);
});

test('keeps reader-owned thumbnail endpoints on the RSS reader origin', () => {
    const normalized = normalizeArticleMediaMarkup(
        '<div><img src="/api/og-image?url=https%3A%2F%2Fpublisher.example%2Fstory"></div>',
        'https://www.techmeme.com/260901/p12'
    );

    assert.match(normalized, /src="\/api\/og-image\?url=https%3A%2F%2Fpublisher\.example%2Fstory"/);
    assert.doesNotMatch(normalized, /techmeme\.com\/api\/og-image/);
});
