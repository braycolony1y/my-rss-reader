import assert from 'node:assert/strict';
import test from 'node:test';
import MarketWatchSource, { cleanMarketWatchArticleHtml } from '../src/sources/MarketWatchSource.js';

const dirty = `<p>Site SearchClear</p><p>SEARCH</p><p>No Results Found</p>
<h3>Tech Stocks</h3><h3>As long as open-source AI models dominate, Nvidia's competitors cannot erode its market share.</h3>
<p>By</p><p><a href="https://www.marketwatch.com/author/britney-nguyen">Britney Nguyen</a></p><p>Share</p>
<figure><img src="https://images.mktw.net/hero.jpg"><figcaption>Nvidia CEO Jensen Huang. Photo: AFP/Getty Images</figcaption></figure>
<p>Nvidia has a history of knowing where to invest to maintain its chip dominance.</p>
<p>Consider the chip maker's</p><p>[</p><p>NVDA</p><p>+0.84%</p><p>](https://www.marketwatch.com/investing/stock/nvda)</p>
<p>$13 billion purchase as health insurance for the company.</p>
<h3>Don't Short Yourself</h3><p>Free Weekly Newsletter</p><p>Subscribe</p><h3>来自 iframe: https://www.marketwatch.com/story/example</h3>
<p>${'The rest of the MarketWatch report remains readable. '.repeat(12)}</p>
<p>Copyright ©2026 MarketWatch, Inc. All Rights Reserved.</p><h4>Related story</h4><p>About the Author</p>`;

test('MarketWatch cleanup removes market chrome, stock chiclets, newsletters, and recommendations', () => {
    const source = new MarketWatchSource();
    const cleaned = cleanMarketWatchArticleHtml(dirty);
    const enhanced = source.enhanceArticleResult({ content: dirty, author: 'Britney Nguyen' });

    assert.equal(source.match('www.marketwatch.com'), true);
    assert.equal(enhanced.author, 'Britney Nguyen');
    assert.match(cleaned, /article-sapo/);
    assert.match(cleaned, /Consider the chip maker(?:'|&apos;)s (?:\$|&#x24;)13 billion purchase/);
    assert.match(cleaned, /rest of the MarketWatch report/);
    assert.doesNotMatch(cleaned, /Site SearchClear|No Results Found|NVDA|0\.84%|Newsletter|Subscribe|iframe:|Copyright|About the Author/);
    assert.equal(cleanMarketWatchArticleHtml(cleaned), cleaned);
});
