import assert from 'node:assert/strict';
import test from 'node:test';
import BloombergSource, {
    cleanBloombergArticleHtml,
    cleanBloombergReaderMarkdown
} from '../src/sources/BloombergSource.js';

const articleUrl = 'https://www.bloomberg.com/news/articles/2026-09-01/roku-launches-its-first-oled-tvs-with-prices-starting-at-999';
const hero = 'https://assets.bwbx.io/images/users/example/hero.webp';
const officialFigure = 'https://imageio.forbes.com/specials-images/imageserve/6a975dd1729364d8ee0abd12/Roku-OLED-TV-Lifestyle-1-High-Res/0x0.jpg?width=960';

const readerMarkdown = `
[Technology](https://www.bloomberg.com/technology)

Consumer Tech

![Roku OLED TVs](${hero})

Roku's first self-branded OLED TVs will only be available from Amazon.

Source: Roku

Gift this article

[Contact us:

Provide news feedback or report an error

](https://www.bloomberg.com/help/question/submit-feedback-news-coverage/)

By [Chris Welch](https://www.bloomberg.com/authors/example/chris-welch)

Save

Translate

### **Takeaways** by Bloomberg AI

- Roku introduced its first self-branded OLED TVs.

Roku introduced the new models with high-refresh screens and thinner bezels.

!

OLED TVs allow for much thinner designs and offer superior picture quality. Source: Roku

[LG Electronics](https://www.bloomberg.com/quote/066570:KP) also sells OLED televisions.

[

Before it's here, it's on the Bloomberg Terminal

LEARN MORE

](https://www.bloomberg.com/professional/)
`;

test('Bloomberg has a dedicated source handler', () => {
    const source = new BloombergSource();
    assert.equal(source.match('www.bloomberg.com'), true);
    assert.equal(source.match('bloomberg.com'), true);
    assert.equal(source.match('example.com'), false);
});

test('Bloomberg reader cleanup keeps the story, hero metadata, links, and missing figure', () => {
    const cleaned = cleanBloombergReaderMarkdown(readerMarkdown, { url: articleUrl });

    assert.equal(cleaned.author, 'Chris Welch');
    assert.equal(cleaned.image, hero);
    assert.equal(cleaned.imageCaption, "Roku's first self-branded OLED TVs will only be available from Amazon. · Source: Roku");
    assert.match(cleaned.markdown, /^### Takeaways by Bloomberg AI/m);
    assert.match(cleaned.markdown, new RegExp(officialFigure.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(cleaned.markdown, /\[LG Electronics\]\(https:\/\/www\.bloomberg\.com\/quote\/066570:KP\)/);
    assert.doesNotMatch(cleaned.markdown, /Gift this article|Contact us|Bloomberg Terminal|^!$/m);
});

test('Bloomberg cached HTML cleanup removes publisher chrome and restores a semantic figure', () => {
    const dirty = `<p><a href="https://www.bloomberg.com/technology">Technology</a></p>
        <p>Consumer Tech</p>
        <p><img src="${hero}" alt="Roku OLED TVs"></p>
        <p>Roku's first self-branded OLED TVs will only be available from Amazon.</p>
        <p>Source: Roku</p>
        <p>Gift this article</p><p>Add us on Google</p>
        <p>[Contact us:</p><p>Provide news feedback or report an error</p><p>](https://example.com)</p>
        <p>By <a href="https://www.bloomberg.com/authors/example">Chris Welch</a></p>
        <p>Save</p><p>Translate</p>
        <h3><strong>Takeaways</strong> by Bloomberg AI</h3>
        <ul><li>Roku introduced its first OLED TVs.</li></ul>
        <p>${'The full article body remains available after cleanup. '.repeat(12)}</p>
        <p>!</p>
        <p>OLED TVs allow for much thinner designs and offer superior picture quality. Source: Roku</p>
        <p><a href="https://www.bloomberg.com/quote/066570:KP">LG Electronics</a> remains linked.</p>
        <p>[</p><p>Before it's here, it's on the Bloomberg Terminal</p><p>LEARN MORE</p><p>](https://example.com)</p>`;

    const first = cleanBloombergArticleHtml(dirty, { url: articleUrl });
    const second = cleanBloombergArticleHtml(first.html, { url: articleUrl });

    assert.equal(first.author, 'Chris Welch');
    assert.equal(first.image, hero);
    assert.equal(first.imageCaption, "Roku's first self-branded OLED TVs will only be available from Amazon. · Source: Roku");
    assert.equal(second.html, first.html);
    assert.match(first.html, /<figure class="article-media-figure bloomberg-figure">/);
    assert.match(first.html, /\/api\/proxy-image\?url=/);
    assert.match(first.html, /<figcaption>OLED TVs allow for much thinner designs/);
    assert.match(first.html, /href="https:\/\/www\.bloomberg\.com\/quote\/066570:KP"/);
    assert.match(first.html, /The full article body remains available/);
    assert.doesNotMatch(first.html, /Gift this article|Contact us|Bloomberg Terminal|<p>!<\/p>/);
});

test('Bloomberg rejects publisher challenge pages', () => {
    const source = new BloombergSource();
    assert.equal(source.isUsableArticleResult({ content: `<p>${'Real Bloomberg article text. '.repeat(30)}</p>` }), true);
    assert.equal(source.isUsableArticleResult({ content: '<h2>Are you a robot?</h2><p>Unusual activity from your computer network.</p>' }), false);
});
