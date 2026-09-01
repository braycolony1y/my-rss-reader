import assert from 'node:assert/strict';
import test from 'node:test';
import TechmemeSource, { canonicalPrimaryArticleUrl, extractTechmemeStory } from '../src/sources/TechmemeSource.js';

const pageUrl = 'https://www.techmeme.com/260830/p11#a260830p11';
const renderedDailyPage = `
    <p>Unrelated story before the requested item.</p>
    <p>&lt;table class=&quot;shrtbl&quot;&gt;&lt;cite&gt;Mark Gurman / &lt;a href=&quot;https://www.bloomberg.com/&quot;&gt;Bloomberg&lt;/a&gt;:&lt;/cite&gt;&lt;span pml=&quot;260830p11&quot;&gt;&lt;/span&gt;&lt;/table&gt;</p>
    <p><a href="https://bloomberg.example/main?accessToken=private&amp;utm_source=techmeme">!</a> <strong><a href="https://bloomberg.example/main?accessToken=private&amp;utm_source=techmeme">Apple leadership changes headline</a></strong> — The main story summary remains with the lead article.</p>
    <p>More: <a href="https://related.example/one">Related Publisher</a>, <a href="https://compact.example/two">Compact-only Publisher</a></p>
    <p>X: <a href="https://x.com/example/status/1">@example</a></p>
    <p>More:</p>
    <p>Writer / <a href="https://related.example/">Related Publisher</a>: <a href="https://related.example/one">A complete related headline</a></p>
    <p>Forums:</p>
    <p><a href="https://forum.example/thread">Forum discussion about the story</a></p>
    <p>X:</p>
    <p><a href="https://x.com/example">@example</a>: <a href="https://x.com/example/status/1">A complete post about the story</a></p>
    <p>&lt;table class=&quot;shrtbl&quot;&gt;&lt;span pml=&quot;260830p12&quot;&gt;&lt;/span&gt;&lt;/table&gt;</p>
    <p>Unrelated story after the requested item.</p>
`;

test('Techmeme has a dedicated source handler', () => {
    const source = new TechmemeSource();
    assert.equal(source.match('www.techmeme.com'), true);
    assert.equal(source.match('example.com'), false);
});

test('Techmeme isolates the selected lead story and separates related articles from X posts', () => {
    const extracted = extractTechmemeStory(renderedDailyPage, pageUrl);

    assert.equal(extracted.title, 'Apple leadership changes headline');
    assert.equal(extracted.author, 'Mark Gurman');
    assert.equal(extracted.mainUrl, 'https://bloomberg.example/main');
    assert.match(extracted.html, /The main story summary remains with the lead article/);
    assert.match(extracted.html, /class="embedded-suggested-articles techmeme-related"/);
    assert.match(extracted.html, /src="\/api\/og-image\?url=/);
    assert.match(extracted.html, /A complete related headline/);
    assert.match(extracted.html, /Compact-only Publisher/);
    assert.match(extracted.html, /Forum · Forum discussion about the story/);
    assert.match(extracted.html, /class="techmeme-x-posts"/);
    assert.match(extracted.html, /class="techmeme-x-post__profile"/);
    assert.match(extracted.html, /class="techmeme-x-post__profile-image" src="\/api\/x-profile-image\?handle=example"/);
    assert.doesNotMatch(extracted.html, /class="techmeme-x-post__avatar"/);
    assert.match(extracted.html, /A complete post about the story/);
    assert.doesNotMatch(extracted.html, /Unrelated story (?:before|after)/);
});

test('Techmeme cached cleanup is idempotent and removes its default logo image', () => {
    const source = new TechmemeSource();
    const first = source.cleanCachedArticleContent(renderedDailyPage, { url: pageUrl });
    const second = source.cleanCachedArticleContent(first, { url: pageUrl });
    const enhanced = source.enhanceArticleResult({
        url: pageUrl,
        title: 'Whole Techmeme page',
        author: '',
        image: 'https://www.techmeme.com/img/mg16.png',
        content: first
    }, { url: pageUrl });

    assert.equal(second, first);
    assert.equal(enhanced.title, 'Apple leadership changes headline');
    assert.equal(enhanced.author, 'Mark Gurman');
    assert.equal(enhanced.image, '');
    assert.equal(enhanced.primaryArticleUrl, 'https://bloomberg.example/main');
    assert.equal(source.isUsableArticleResult(enhanced, { url: pageUrl }), true);
    assert.equal(source.isUsableArticleResult({
        url: pageUrl,
        content: '<h2>Attention Required! | Cloudflare</h2><p>Please enable cookies.</p>'
    }, { url: pageUrl }), false);
});

test('Techmeme strips gifted-access parameters and expands the canonical main publisher article', async () => {
    assert.equal(
        canonicalPrimaryArticleUrl('https://publisher.example/story?accessToken=secret&utm_source=techmeme&edition=global#comments'),
        'https://publisher.example/story?edition=global'
    );

    const source = new TechmemeSource();
    const cleaned = source.cleanCachedArticleContent(renderedDailyPage, { url: pageUrl });
    const expanded = await source.expandArticleResult({
        url: pageUrl,
        title: 'Techmeme',
        content: cleaned
    }, {
        url: pageUrl,
        fetchPrimaryArticle: async url => ({
            url,
            title: 'Apple leadership changes headline',
            author: 'Mark Gurman',
            siteName: 'Bloomberg',
            image: 'https://publisher.example/hero.jpg',
            imageCaption: 'Publisher hero caption',
            fetchStrategy: 'jina',
            content: `<p>${'Full publisher article paragraph. '.repeat(25)}</p>`
        })
    });

    assert.equal(expanded.primaryArticleUrl, 'https://bloomberg.example/main');
    assert.equal(expanded.primarySource.name, 'Bloomberg');
    assert.equal(expanded.primaryArticleFetched, true);
    assert.equal(expanded.imageCaption, 'Publisher hero caption');
    assert.match(expanded.content, /class="techmeme-primary-article"/);
    assert.match(expanded.content, /Full publisher article paragraph/);
    assert.doesNotMatch(expanded.content, /Full article from/);
    assert.match(expanded.content, /class="techmeme-x-post__profile"/);
    assert.doesNotMatch(expanded.content, /class="techmeme-x-post__avatar"/);
});
