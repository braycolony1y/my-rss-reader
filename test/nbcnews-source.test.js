import assert from 'node:assert/strict';
import test from 'node:test';
import NbcNewsSource, { cleanNbcNewsArticleHtml } from '../src/sources/NbcNewsSource.js';

const dirty = `<p><img src="https://media-cldnry.s-nbcnews.com/hero.jpg" alt="Sam Altman"></p>
<p>OpenAI CEO Sam Altman in Oakland. Josh Edelson / AFP via Getty Images file</p>
<p>Share</p><p><a href="https://www.google.com/preferences/source?q=nbcnews.com">Add to Google</a></p>
<p>Sept. 4, 2026, 11:00 AM UTC</p>
<p>By <a href="https://www.nbcnews.com/author/jared-perlo">Jared Perlo</a></p>
<p>${'The complete NBC News article remains available after cleanup. '.repeat(12)}</p>
<p>Share</p><p><a href="https://www.nbcnews.com/author/jared-perlo">!</a></p>
<p>Jared Perlo is a technology reporter for NBC News Digital.</p>`;

test('NBC News cleanup removes sharing chrome and formats the hero as a figure', () => {
    const source = new NbcNewsSource();
    const cleaned = cleanNbcNewsArticleHtml(dirty);
    const enhanced = source.enhanceArticleResult({ content: dirty, author: 'NBCNews' });

    assert.equal(source.match('www.nbcnews.com'), true);
    assert.equal(enhanced.author, 'Jared Perlo');
    assert.match(cleaned, /<figure class="article-media-figure nbcnews-figure">/);
    assert.match(cleaned, /<figcaption>OpenAI CEO Sam Altman/);
    assert.match(cleaned, /complete NBC News article/);
    assert.doesNotMatch(cleaned, /Add to Google|>Share<|NBC News Digital|11:00 AM UTC/);
    assert.equal(cleanNbcNewsArticleHtml(cleaned), cleaned);
});

test('NBC News direct subscriber shell becomes a formatted partial preview with a real author', () => {
    const source = new NbcNewsSource();
    const direct = `<section data-testid="article-hero"><div data-testid="article-dek">A useful article summary.</div>
        <figure><img src="https://media-cldnry.s-nbcnews.com/hero.jpg"></figure>
        <figcaption data-testid="caption">A useful caption. Photo: NBC News</figcaption></section>
        <div class="article-body"><span data-testid="byline-name">Jared Perlo</span>
        <div data-subscriber-content><p class="body-graf">The publisher exposed this opening paragraph as its subscriber preview.</p></div></div>`;
    const result = { author: '{"authors":["Jared Perlo"]}', description: 'The publisher exposed this opening paragraph as its subscriber preview.' };
    const parsed = source.parseArticleHtmlContent(direct, 'https://www.nbcnews.com/example', result);
    const enhanced = source.enhanceArticleResult({ ...result, content: parsed });

    assert.equal(enhanced.author, 'Jared Perlo');
    assert.equal(enhanced.partialContent, true);
    assert.match(enhanced.partialContentReason, /subscriber preview/);
    assert.match(enhanced.content, /nbcnews-figure/);
    assert.match(enhanced.content, /opening paragraph/);
    assert.doesNotMatch(enhanced.content, /article-body|subscriber-content/);
});
