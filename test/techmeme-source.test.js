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

test('Techmeme never inserts a publisher robot-check page as the primary article', async () => {
    const source = new TechmemeSource();
    const cleaned = source.cleanCachedArticleContent(renderedDailyPage, { url: pageUrl });
    const challengePages = [
        `<h2>We've detected unusual activity from your computer network</h2><p>${'Please click the box below to let us know you are not a robot. '.repeat(20)}</p>`,
        `<h3>Why did this happen?</h3><p>Please make sure your browser supports JavaScript and cookies and that you are not blocking them from loading.</p><p>Block reference ID: example</p>${'<p>Subscription information.</p>'.repeat(30)}`,
        `<h2>Before we continue...</h2><p>Press &amp; Hold to confirm you are a human (and not a bot).</p><p>Reference ID 8ba9665a-a69c-11f1-944f-ce4969283d14</p>${'<p>Verification required.</p>'.repeat(30)}`
    ];

    for (const content of challengePages) {
        const expanded = await source.expandArticleResult({
            url: pageUrl,
            title: 'Techmeme',
            content: cleaned
        }, {
            url: pageUrl,
            fetchPrimaryArticle: async () => ({
                title: 'Bloomberg',
                content
            })
        });

        assert.notEqual(expanded.primaryArticleFetched, true);
        assert.doesNotMatch(expanded.content, /techmeme-primary-article/);
        assert.doesNotMatch(expanded.content, /unusual activity|block reference id|press &amp; hold/i);
    }
});

test('Techmeme promotes a high-resolution primary-source image over its tiny feed thumbnail and publisher icons', async () => {
    const source = new TechmemeSource();
    const cleaned = source.cleanCachedArticleContent(renderedDailyPage, { url: pageUrl });
    const expanded = await source.expandArticleResult({
        url: pageUrl,
        title: 'Techmeme',
        image: 'https://www.techmeme.com/260830/i11.jpg',
        content: cleaned
    }, {
        url: pageUrl,
        fetchPrimaryArticle: async () => ({
            title: 'Primary article',
            image: 'https://publisher.example/assets/status-icon.svg',
            content: `<p><img src="https://publisher.example/avatar.jpg?w=60&h=60" alt="thumbnail"></p><p><img src="https://publisher.example/hero.jpg?w=1200&h=675" alt="Article hero"></p><p>${'Complete article body. '.repeat(30)}</p>`
        })
    });

    assert.equal(source.isInvalidFeedImage('http://www.techmeme.com/260830/i11.jpg'), true);
    assert.equal(source.isInvalidFeedImage('https://substackcdn.com/image/fetch/$s_!x!,w_36,h_36,c_fill/example.jpg'), true);
    assert.equal(source.isInvalidFeedImage('https://substackcdn.com/image/fetch/$s_!x!,w_1456,c_limit/example.jpg'), false);
    assert.equal(expanded.image, 'https://publisher.example/hero.jpg?w=1200&h=675');
    assert.equal(source.primaryImageTarget(expanded), 'https://bloomberg.example/main');
});

test('Techmeme upgrades an already cached Bloomberg primary article without refetching it', () => {
    const source = new TechmemeSource();
    const bloombergUrl = 'https://www.bloomberg.com/news/articles/2026-09-01/roku-launches-its-first-oled-tvs-with-prices-starting-at-999';
    const cached = `<article class="techmeme-story" data-techmeme-story-id="260830p11" data-techmeme-author="Chris Welch" data-techmeme-publisher="Bloomberg" data-techmeme-main-url="${bloombergUrl}">
        <header class="techmeme-main-story"><div class="techmeme-main-story__source">Chris Welch / Bloomberg</div><h2><a href="${bloombergUrl}">Roku OLED TVs</a></h2></header>
        <section class="techmeme-primary-article" aria-label="Article from Bloomberg"><div class="techmeme-primary-article__content">
            <p><img src="https://assets.bwbx.io/images/users/example/hero.webp" alt="Roku OLED TVs"></p>
            <p>Roku's first self-branded OLED TVs will only be available from Amazon.</p><p>Source: Roku</p>
            <p>Gift this article</p><p>Add us on Google</p><p>By <a href="https://www.bloomberg.com/authors/example">Chris Welch</a></p><p>Save</p><p>Translate</p>
            <h3><strong>Takeaways</strong> by Bloomberg AI</h3><ul><li>Roku introduced its first OLED TVs.</li></ul>
            <p>${'The cached Bloomberg article body remains ready to serve. '.repeat(14)}</p>
            <p>!</p><p>OLED TVs allow for much thinner designs and offer superior picture quality. Source: Roku</p>
            <p>[</p><p>Before it's here, it's on the Bloomberg Terminal</p><p>LEARN MORE</p>
        </div></section>
    </article>`;

    const first = source.cleanCachedArticleContent(cached, { url: pageUrl, primaryArticleUrl: bloombergUrl });
    const second = source.cleanCachedArticleContent(first, { url: pageUrl, primaryArticleUrl: bloombergUrl });
    const enhanced = source.enhanceArticleResult({
        url: pageUrl,
        content: first,
        image: '',
        imageCaption: '',
        primaryArticleUrl: bloombergUrl
    }, { url: pageUrl });

    assert.equal(second, first);
    assert.equal(enhanced.author, 'Chris Welch');
    assert.equal(enhanced.image, 'https://assets.bwbx.io/images/users/example/hero.webp');
    assert.match(enhanced.imageCaption, /Roku's first self-branded OLED TVs.*Source: Roku/);
    assert.match(enhanced.content, /class="article-media-figure bloomberg-figure"/);
    assert.match(enhanced.content, /The cached Bloomberg article body remains ready to serve/);
    assert.doesNotMatch(enhanced.content, /Gift this article|Bloomberg Terminal|<p>!<\/p>/);
});
