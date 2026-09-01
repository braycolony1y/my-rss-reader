import assert from 'node:assert/strict';
import test from 'node:test';
import FinancialTimesSource, {
    cleanFinancialTimesBrowserMarkdown,
    cleanFinancialTimesRenderedContent,
    extractFinancialTimesByline,
    extractFinancialTimesChartUrls,
    extractFinancialTimesHeroMedia,
    extractFinancialTimesLatestArticles,
    extractFinancialTimesPrimaryImage,
    isFinancialTimesPlaceholderImage
} from '../src/sources/FinancialTimesSource.js';
import { jinaMarkdownToHtml, parseOpenCliMarkdown } from '../server.js';

const articleUrl = 'https://www.ft.com/content/example-article?syn-test=1';
const browserMarkdown = `
# A Financial Times headline
> 作者: Example Author
> 发布时间: 2026-08-31T17:19:13.782Z
> 原文链接: ${articleUrl}

---

![Lead image](https://images.ft.com/v3/image/raw/example.jpg?width=1440)

Lead image caption © Example

-   [

    A Financial Times headline on x (opens in a new window)](https://twitter.com/intent/tweet?url=${encodeURIComponent(articleUrl)})

current progress 0%

[Example Author](https://www.ft.com/example-author) in London

Publishedan hour ago

[12](#comments-anchor "Jump to comments section")Print this page

Unlock the Example newsletter for free

Publisher newsletter description

## 来自 iframe: https://www.ft.com/register/in-article-sign-up?newsletter-id=example

[Accessibility help](https://www.ft.com/accessibility)[Skip to main content](#site-content)

Need help?Start chat

Close help popup

![](https://bat.bing.com/action/0?tracking=1)

First editorial paragraph with enough text to represent the article body.

Second editorial paragraph with additional reporting and context.

The result “validates \\[a\\] a cyclical upturn” and preserves a [fined €550mn](https://www.ft.com/content/13c385e7-600f-471a-858e-6f1970802a10?syn-test=1) inline link.

[Reuse this content (opens in new window)](https://enterprise.ft.com/republish)

## Follow the topics in this article

- [Example topic](https://www.ft.com/example-topic)

## Latest on Example topic
`;

test('Financial Times has its own source handler', () => {
    const source = new FinancialTimesSource();
    assert.equal(source.match('www.ft.com'), true);
    assert.equal(source.match('ft.com'), true);
    assert.equal(source.match('example.com'), false);
});

test('shared Markdown rendering preserves links, emphasis, literal underscores, and references', () => {
    const rendered = jinaMarkdownToHtml(
        'Keep file_name and \\_literal\\_ intact; render _italic words_ and [linked _terms_](https://publisher.example.com/story?from=rss). Preserve \\[a\\], [b](#note-b), and [c].',
        'https://publisher.example.com/article'
    );

    assert.match(rendered, /Keep file_name and _literal_ intact/);
    assert.match(rendered, /<em>italic words<\/em>/);
    assert.match(rendered, /<a class="article-inline-link" href="https:\/\/publisher\.example\.com\/story\?from=rss"[^>]*>linked <em>terms<\/em><\/a>/);
    assert.match(rendered, /class="article-reference-marker"[^>]*>\[a\]<\/sup>/);
    assert.match(rendered, /<sup class="article-reference-marker"><a class="article-inline-link" href="#note-b">\[b\]<\/a><\/sup>/);
    assert.match(rendered, /class="article-reference-marker"[^>]*>\[c\]<\/sup>/);
    assert.doesNotMatch(rendered, /\\[_\[\]]/);
});

test('ordinary non-captioned photos remain ordinary media', () => {
    const rendered = jinaMarkdownToHtml(
        '![A normal photo](https://cdn.example.com/photo.jpg)\n\nA full editorial paragraph follows the image.',
        'https://publisher.example.com/article'
    );

    assert.match(rendered, /<p><img src="https:\/\/cdn\.example\.com\/photo\.jpg" alt="A normal photo"><\/p>/);
    assert.doesNotMatch(rendered, /article-graphic-figure|article-reference-marker/);
});

test('Financial Times browser cleanup keeps editorial content and removes page chrome', () => {
    const cleaned = cleanFinancialTimesBrowserMarkdown(browserMarkdown);

    assert.doesNotMatch(cleaned, /Lead image caption|images\.ft\.com/);
    assert.match(cleaned, /First editorial paragraph/);
    assert.match(cleaned, /Second editorial paragraph/);
    assert.doesNotMatch(cleaned, /on x \(opens in a new window\)/);
    assert.doesNotMatch(cleaned, /current progress/);
    assert.doesNotMatch(cleaned, /newsletter for free/);
    assert.doesNotMatch(cleaned, /Accessibility help/);
    assert.doesNotMatch(cleaned, /bat\.bing\.com/);
    assert.doesNotMatch(cleaned, /Reuse this content/);
    assert.doesNotMatch(cleaned, /Latest on/);
});

test('OpenCLI parsing applies Financial Times cleanup without losing metadata', () => {
    const parsed = parseOpenCliMarkdown(browserMarkdown, articleUrl, {
        diagnostics: '[frame 1] cross-origin blocked text=0 https://flo.uri.sh/visualisation/30108668/embed?auto=1'
    });

    assert.equal(parsed.title, 'A Financial Times headline');
    assert.equal(parsed.author, 'Example Author in London');
    assert.equal(parsed.date, '2026-08-31T17:19:13.782Z');
    assert.equal(parsed.siteName, 'ft.com');
    assert.match(parsed.image, /^https:\/\/images\.ft\.com\//);
    assert.equal(parsed.imageCaption, 'Lead image caption © Example');
    assert.doesNotMatch(parsed.content, /Lead image caption|images\.ft\.com/);
    assert.match(parsed.content, /class="article-reference-marker"[^>]*>\[a\]<\/sup>/);
    assert.match(parsed.content, /<a class="article-inline-link" href="https:\/\/www\.ft\.com\/content\/13c385e7-600f-471a-858e-6f1970802a10\?syn-test=1"[^>]*>fined (?:€|&#x20ac;)550mn<\/a>/);
    assert.match(parsed.content, /<figure class="article-media-figure article-graphic-figure ft-chart-figure"[^>]*data-ft-recovered-chart="true"/);
    assert.match(parsed.content, /<iframe class="article-graphic-embed ft-chart-embed"[^>]+visualisation\/30108668\/embed\?auto=1/);
    assert.match(parsed.content, /First editorial paragraph/);
    assert.match(parsed.content, /Second editorial paragraph/);
    assert.doesNotMatch(parsed.content, /current progress|newsletter for free|Reuse this content|Latest on/i);
    assert.doesNotMatch(parsed.content, /\\\[a\\\]/);
});

test('Financial Times detaches a hero caption for placement directly under the overlay image', () => {
    const media = extractFinancialTimesHeroMedia(browserMarkdown);
    assert.match(media.image, /images\.ft\.com/);
    assert.equal(media.imageCaption, 'Lead image caption © Example');
    assert.doesNotMatch(media.markdown, /Lead image caption|images\.ft\.com/);

    const source = new FinancialTimesSource();
    const enhanced = source.enhanceArticleResult({
        url: 'https://www.ft.com/content/66df7f0e-ce6a-4619-8044-fa23423db3e7',
        author: '',
        image: media.image,
        content: '<h2>There’s no time to cry, happy, happy</h2><p>Sky Xu at the listing ceremony © Bloomberg</p><p>Article body.</p>'
    }, { url: 'https://www.ft.com/content/66df7f0e-ce6a-4619-8044-fa23423db3e7' });
    assert.equal(enhanced.author, 'Craig Coben');
    assert.equal(enhanced.imageCaption, 'Sky Xu at the listing ceremony © Bloomberg');
    assert.doesNotMatch(enhanced.content, /listing ceremony/);
});

test('Financial Times diagnostics retain each supported chart embed', () => {
    const urls = extractFinancialTimesChartUrls(`
        [frame 1] https://flo.uri.sh/visualisation/30108668/embed?auto=1
        [frame 2] https://public.flourish.studio/visualisation/42/embed
        [frame 3] https://doubleclick.example/frame
    `);
    assert.deepEqual(urls, [
        'https://flo.uri.sh/visualisation/30108668/embed?auto=1',
        'https://public.flourish.studio/visualisation/42/embed'
    ]);
});

test('Financial Times reconstructs missing multi-author names with their locations', () => {
    const byline = extractFinancialTimesByline(`
        > 作者: Kana Inagaki and Cheng Leng
        current progress 0%
        in Tokyo and in Hong Kong
        Published an hour ago
    `);
    assert.equal(byline, 'Kana Inagaki in Tokyo and Cheng Leng in Hong Kong');
});

test('Financial Times rejects prose accidentally reported as an author and recovers the linked byline', () => {
    const byline = extractFinancialTimesByline(`
        > 作者: Rising public debt in global finance ought to be collapsing. Policymakers [talk incessantly](https://example.com/story) about ditching the dollar.
        current progress 0%
        [Eswar Prasad](https://www.ft.com/stream/50ebd034-6a72-4f02-8d9f-71c5ca3203aa)
        Published yesterday
    `);
    assert.equal(byline, 'Eswar Prasad');
});

test('Financial Times restores its RSS standfirst through the source handler only once', () => {
    const source = new FinancialTimesSource();
    const description = 'The evolution of a truly multi-polar currency market depends on governments’ willingness to embrace technology and fortify markets';
    const enhanced = source.enhanceArticleResult({
        author: 'A paragraph that is not a byline. It should never appear in the author bubble.',
        content: '<p>First article paragraph with the full analysis.</p>'
    }, {
        url: 'https://www.ft.com/content/1481e787-77dc-4d54-8871-8ffb369e5dd3',
        description
    });
    const enhancedAgain = source.enhanceArticleResult(enhanced, { description });

    assert.equal(enhanced.author, 'Eswar Prasad');
    assert.match(enhanced.content, /data-ft-standfirst="true"/);
    assert.match(enhanced.content, /The evolution of a truly multi-polar currency market/);
    assert.equal((enhancedAgain.content.match(/data-ft-standfirst=/g) || []).length, 1);
});

test('Financial Times primary images beat placeholder artwork', () => {
    const markdown = `
        ![Product](https://images.ft.com/v3/image/raw/https%3A%2F%2Fbarrier-page-components.example%2Fprimary_product_icon_standard.svg?format=svg)
        ![Hero](https://images.ft.com/v3/image/raw/ftcms%3Ahero-id?source=next-article&quality=highest&width=1440)
    `;
    assert.equal(isFinancialTimesPlaceholderImage('https://images.ft.com/v3/image/raw/ftlogo:brand-ft?format=svg'), true);
    assert.equal(isFinancialTimesPlaceholderImage('https://bat.bing.com/action/0?tracking=1'), true);
    assert.equal(
        extractFinancialTimesPrimaryImage(markdown),
        'https://images.ft.com/v3/image/raw/ftcms%3Ahero-id?source=next-article&quality=highest&width=1440'
    );
});

test('Financial Times requests eager thumbnail resolution during feed ingestion', () => {
    const source = new FinancialTimesSource();
    assert.equal(source.shouldResolveImageOnIngest(), true);
});

test('Financial Times thumbnail extraction falls back to its browser-rendered hero', async () => {
    const source = new FinancialTimesSource();
    const hero = 'https://images.ft.com/v3/image/raw/ftcms%3A7ba4066f-1a8f-47be-946b-185f2dfdee77?source=next-article&quality=highest&width=1440';
    let browserReads = 0;
    const image = await source.getBestImage(articleUrl, async () => ({ ok: false }), '', {
        fetchWithCookies: async () => '<title>Security Verification</title>',
        fetchArticleWithBrowser: async () => {
            browserReads += 1;
            return { image: hero };
        },
        isInvalidImage: value => !value,
        CF_PROXY_BASE: ''
    });

    assert.equal(image, hero);
    assert.equal(browserReads, 1);
});

test('Financial Times HTML extraction preserves linked prose, figures, and chart embeds', () => {
    const source = new FinancialTimesSource();
    const result = { description: 'A useful standfirst that is long enough to render as introductory copy.' };
    const extracted = source.parseArticleHtmlContent(`
        <article>
            <div class="article-info__byline">Kana Inagaki in Tokyo and Cheng Leng in Hong Kong</div>
            <div class="article__content-body">
                <p>First editorial paragraph with enough reporting text to remain in the extracted article body.</p>
                <figure><picture><img src="https://images.ft.com/v3/image/raw/ftcms%3Aphoto?source=next-article&width=1440"></picture><figcaption>Photo caption © Reuters</figcaption></figure>
                <p>The company was <a href="https://www.ft.com/content/linked-story">fined €550mn</a> under the rules.</p>
                <iframe src="https://flo.uri.sh/visualisation/30108668/embed?auto=1"></iframe>
                <p>Final editorial paragraph with enough additional context to satisfy content extraction.</p>
            </div>
        </article>
    `, articleUrl, result);

    assert.equal(result.author, 'Kana Inagaki in Tokyo and Cheng Leng in Hong Kong');
    assert.match(extracted, /<figure>[\s\S]*<figcaption>Photo caption (?:©|&#xa9;) Reuters<\/figcaption><\/figure>/);
    assert.match(extracted, /<a href="https:\/\/www\.ft\.com\/content\/linked-story">fined (?:€|&#x20ac;)550mn<\/a>/);
    assert.match(extracted, /article-graphic-embed ft-chart-embed/);
});

test('cached Financial Times HTML is repaired without refetching', () => {
    const cached = `
        <p><img src="https://images.ft.com/lead.jpg" alt="Lead"></p>
        <p>Lead image caption</p>
        <ul><li>[</li></ul>
        <p>Headline on facebook (opens in a new window)](https://facebook.example)</p>
        <p>current progress 0%</p>
        <p>Example Author in London</p>
        <p>Publishedan hour ago</p>
        <p>Unlock the Example newsletter for free</p>
        <p>Close help popup</p>
        <p>!</p>
        <p>First editorial paragraph.</p>
        <p>Second editorial paragraph.</p>
        <p>Reuse this content (opens in new window)</p>
        <h3>Follow the topics in this article</h3>
    `;
    const cleaned = cleanFinancialTimesRenderedContent(cached);

    assert.match(cleaned, /Lead image caption/);
    assert.match(cleaned, /First editorial paragraph/);
    assert.match(cleaned, /Second editorial paragraph/);
    assert.doesNotMatch(cleaned, /facebook|current progress|Published|newsletter|Reuse|Follow the topics/i);
});

test('Financial Times turns chart paragraphs into roomy figures and merges adjacent quote paragraphs', () => {
    const cleaned = cleanFinancialTimesRenderedContent(`
        <p>Introductory article paragraph.</p>
        <p class="article-graphic-figure ft-chart-figure"><img src="https://images.ft.com/chart-standard.png" alt="Line chart showing money matters"></p>
        <blockquote>First, the first reason.</blockquote>
        <blockquote>Second, the second reason.</blockquote>
        <blockquote>Third, the third reason.</blockquote>
    `);

    assert.match(cleaned, /<figure class="article-graphic-figure ft-chart-figure article-media-figure"/);
    assert.match(cleaned, /class="article-graphic-image ft-chart-image"/);
    assert.equal((cleaned.match(/<blockquote/g) || []).length, 1);
    assert.match(cleaned, /<blockquote class="ft-multi-paragraph-quote"><p>First,[\s\S]*<p>Second,[\s\S]*<p>Third,/);
});

test('Financial Times Latest on data renders as a compact event stream', () => {
    const latest = extractFinancialTimesLatestArticles(`
        ## Latest on Sovereign bonds
        - ![Bond market](https://images.ft.com/v3/image/raw/ftcms%3Aexample?source=next-article&fit=scale-down&width=700) Japanese government bonds [Japan's benchmark bond yield hits 3%](https://www.ft.com/content/11111111-1111-1111-1111-111111111111?syn-test=1)
        - Global Economy [Rising bond yields add to debt costs](https://www.ft.com/content/22222222-2222-2222-2222-222222222222)
        ## Follow the topics in this article
    `);
    const cleaned = cleanFinancialTimesRenderedContent('<p>Article body.</p>', { latestArticles: latest });

    assert.equal(latest.items.length, 2);
    assert.match(cleaned, /class="tuoitre-event-stream ft-latest-stream"/);
    assert.match(cleaned, /Latest on/);
    assert.match(cleaned, /Sovereign bonds/);
    assert.match(cleaned, /class="ft-latest-stream__thumbnail"/);
    assert.match(cleaned, /https:\/\/images\.ft\.com\/v3\/image\/raw/);
    assert.match(cleaned, /class="ft-latest-stream__category">Japanese government bonds/);
    assert.match(cleaned, /Japan(?:'|&apos;)s benchmark bond yield hits 3%/);
    assert.match(cleaned, /Rising bond yields add to debt costs/);
});
