import assert from 'node:assert/strict';
import test from 'node:test';
import NytSource, { cleanNytArticleHtml } from '../src/sources/NytSource.js';

const dirty = `<p><a href="#after-top">SKIP ADVERTISEMENT</a></p>
<p>${'Diesel fuel prices jumped to a record high as global energy supplies tightened. '.repeat(8)}</p>
<p>Image<img src="https://static01.nyt.com/hero.jpg" alt="Freight trucks"></p>
<p>Diesel fuels power commercial vehicles. Credit...Stella Kalinina for The New York Times</p>
<p>${'The rest of the New York Times article remains readable. '.repeat(8)}</p>
<p><a href="https://www.nytimes.com/by/gregory-schmidt">Gregory Schmidt</a> is a senior staff editor who covers business.</p>
<p>See more on: Russia-Ukraine War</p><p>Read 3 comments</p><h3>Related Content</h3>`;

test('New York Times cleanup fixes author, image caption, and publisher controls', () => {
    const source = new NytSource();
    const cleaned = cleanNytArticleHtml(dirty);
    const enhanced = source.enhanceArticleResult({ content: dirty, author: 'https://www.nytimes.com/by/gregory-schmidt' });

    assert.equal(source.match('www.nytimes.com'), true);
    assert.equal(enhanced.author, 'Gregory Schmidt');
    assert.match(cleaned, /<figure class="article-media-figure nyt-figure">/);
    assert.match(cleaned, /<figcaption>Diesel fuels power commercial vehicles/);
    assert.match(cleaned, /rest of the New York Times article/);
    assert.doesNotMatch(cleaned, /SKIP ADVERTISEMENT|>Image<|senior staff editor|See more on|comments|Related Content/);
    assert.equal(cleanNytArticleHtml(cleaned), cleaned);
});
