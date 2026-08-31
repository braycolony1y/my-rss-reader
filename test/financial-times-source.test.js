import assert from 'node:assert/strict';
import test from 'node:test';
import FinancialTimesSource, {
    cleanFinancialTimesBrowserMarkdown,
    cleanFinancialTimesRenderedContent
} from '../src/sources/FinancialTimesSource.js';
import { parseOpenCliMarkdown } from '../server.js';

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

test('Financial Times browser cleanup keeps editorial content and removes page chrome', () => {
    const cleaned = cleanFinancialTimesBrowserMarkdown(browserMarkdown);

    assert.match(cleaned, /Lead image caption/);
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
    const parsed = parseOpenCliMarkdown(browserMarkdown, articleUrl);

    assert.equal(parsed.title, 'A Financial Times headline');
    assert.equal(parsed.author, 'Example Author');
    assert.equal(parsed.date, '2026-08-31T17:19:13.782Z');
    assert.equal(parsed.siteName, 'ft.com');
    assert.match(parsed.image, /^https:\/\/images\.ft\.com\//);
    assert.match(parsed.content, /First editorial paragraph/);
    assert.match(parsed.content, /Second editorial paragraph/);
    assert.doesNotMatch(parsed.content, /current progress|newsletter for free|Reuse this content|Latest on/i);
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
