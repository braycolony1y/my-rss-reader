import test from 'node:test';
import assert from 'node:assert/strict';

import BBCSource from '../src/sources/BBCSource.js';

const escapeHtml = value => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

test('BBC parser uses the slim local parser and preserves article features', () => {
    const source = new BBCSource();
    const result = {};
    const parsed = source.parseArticleHtmlContent(`
        <html><body>
            <h1>BBC headline</h1>
            <article>
                <div data-component="share-panel">Share this</div>
                <p>Main story text.</p>
                <figure>
                    <picture><source srcset="small.jpg 320w, large.jpg 1280w"></picture>
                    <figcaption>News photo</figcaption>
                </figure>
                <section><h2>More on this story</h2></section>
                <ul><li><a href="/news/related">Related report</a></li></ul>
            </article>
        </body></html>
    `, 'https://www.bbc.com/news/example', result, { escapeHtml });

    assert.equal(result.title, 'BBC headline');
    assert.match(parsed, /Main story text/);
    assert.match(parsed, /src="large\.jpg"/);
    assert.match(parsed, /https:\/\/www\.bbc\.com\/news\/related/);
    assert.doesNotMatch(parsed, /Share this/);
});
