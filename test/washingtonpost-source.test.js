import assert from 'node:assert/strict';
import test from 'node:test';
import WashingtonPostSource, { cleanWashingtonPostArticleHtml } from '../src/sources/WashingtonPostSource.js';

const dirty = `<div class="grid-full-inner-standard"><svg><path d="long-logo"></path></svg>
<figure data-testid="lede-image"><img src="https://washingtonpost.com/hero.jpg"></figure>
<figcaption data-testid="lede-art-caption">A job fair in Florida. (AP)</figcaption>
<div data-testid="author-name-with-optional-link">By Lauren Kaori Gurley</div>
<article><div class="article-body" data-qa="article-body"><p>The U.S. economy churned out 162,000 jobs in August, blowing past expectations even as employers grappled with headwinds.</p></div></article>
<h2>Most Read</h2><p>Unrelated navigation and recommendations.</p></div>`;

test('Washington Post cleanup keeps only the publisher preview and marks it partial', () => {
    const source = new WashingtonPostSource();
    const cleaned = cleanWashingtonPostArticleHtml(dirty);
    const enhanced = source.enhanceArticleResult({ content: dirty, author: 'Lauren Kaori Gurley' });

    assert.equal(source.match('www.washingtonpost.com'), true);
    assert.match(cleaned, /washington-post-reader/);
    assert.match(cleaned, /A job fair in Florida/);
    assert.match(cleaned, /economy churned out 162,000 jobs/);
    assert.doesNotMatch(cleaned, /long-logo|Most Read|Unrelated navigation/);
    assert.equal(enhanced.partialContent, true);
    assert.match(enhanced.partialContentReason, /short preview/);
    assert.equal(cleanWashingtonPostArticleHtml(cleaned), cleaned);
});
