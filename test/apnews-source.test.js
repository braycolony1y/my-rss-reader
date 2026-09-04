import assert from 'node:assert/strict';
import test from 'node:test';
import ApnewsSource, { cleanApArticleHtml, cleanApReaderMarkdown, isInvalidApImage } from '../src/sources/ApnewsSource.js';

const articleUrl = 'https://apnews.com/article/example-story-123';
const authorAvatar = 'https://dims.apnews.com/dims4/default/a/resize/60x60!/quality/90/?url=https%3A%2F%2Fassets.apnews.com%2Fauthor.jpg';
const bodyImage = 'https://dims.apnews.com/dims4/default/b/resize/980x653!/quality/90/?url=https%3A%2F%2Fassets.apnews.com%2Fstory.jpg';
const shareImage = 'https://assets.apnews.com/story-hero.jpg';

const readerMarkdown = `
## Example AP headline

0 seconds of 2 minutes Volume 0%

Keyboard Shortcuts Enabled Disabled

Subtitle Settings

More Videos

* [Pinterest](https://pinterest.com/pin/create/?media=${encodeURIComponent(shareImage)})

![Author](${authorAvatar})

By [JANE REPORTER](https://apnews.com/author/jane-reporter)

Share

* [Facebook](https://facebook.com/share)

WASHINGTON (AP) — ${'The opening paragraph contains the complete article lead and enough useful text for the reader. '.repeat(3)}

${'A second article paragraph remains before the publisher inserts unrelated recommendations. '.repeat(3)}

Related Stories

[![A related story](${bodyImage})](https://apnews.com/article/related)

[A related story](https://apnews.com/article/related)

3 MIN READ

${'The main report continues after the related-story module and must not be truncated. '.repeat(4)}

[](${articleUrl})![Image 41: A useful article photo](${bodyImage})

A useful article photo

![Image 42: A useful article photo](${bodyImage})

A useful article photo

Add AP News on Google Add AP News as your preferred source to see more of our stories on Google. Share

Share

* [X](https://twitter.com/intent/tweet)

Read More

## A later article section

${'The final section is part of the real article and remains available after cleanup. '.repeat(4)}

[![Image 55: JANE REPORTER](${authorAvatar})](https://apnews.com/author/jane-reporter)

[JANE REPORTER](https://apnews.com/author/jane-reporter)

## Active Conversations

The following is a list of the most commented articles.
`;

test('AP has a dedicated source handler and rejects tiny author images', () => {
    const source = new ApnewsSource();
    assert.equal(source.match('apnews.com'), true);
    assert.equal(source.match('www.apnews.com'), true);
    assert.equal(source.match('example.com'), false);
    assert.equal(isInvalidApImage(authorAvatar), true);
    assert.equal(isInvalidApImage(bodyImage), false);
});

test('AP reader cleanup removes player chrome and recommendations without truncating the story', () => {
    const cleaned = cleanApReaderMarkdown(readerMarkdown);

    assert.equal(cleaned.author, 'JANE REPORTER');
    assert.equal(cleaned.image, shareImage);
    assert.match(cleaned.markdown, /^WASHINGTON \(AP\) —/);
    assert.match(cleaned.markdown, /main report continues after the related-story module/);
    assert.match(cleaned.markdown, /## A later article section/);
    assert.equal((cleaned.markdown.match(/!\[/g) || []).length, 1);
    assert.doesNotMatch(cleaned.markdown, /Keyboard Shortcuts|Subtitle Settings|More Videos/);
    assert.doesNotMatch(cleaned.markdown, /Related Stories|MIN READ|Active Conversations/);
    assert.doesNotMatch(cleaned.markdown, /Add AP News|Facebook|twitter\.com/);
});

test('AP rejects unclean article-reader output', () => {
    const source = new ApnewsSource();
    assert.equal(source.isUsableArticleResult({ content: `<p>${'A clean AP report. '.repeat(40)}</p>` }), true);
    assert.equal(source.isUsableArticleResult({ content: `<p>${'Keyboard Shortcuts and More Videos. '.repeat(30)}</p>` }), false);
});

test('AP cached HTML keeps each photo caption directly below its image', () => {
    const html = `<p>${'A complete AP article paragraph. '.repeat(20)}</p>
        <p><img src="${bodyImage}" alt="A useful article photo (AP Photo/Example)"></p>
        <p>A useful article photo (AP Photo/Example)</p>`;
    const first = cleanApArticleHtml(html);
    const second = cleanApArticleHtml(first);

    assert.equal(second, first);
    assert.match(first, /<figure class="article-media-figure apnews-figure">/);
    assert.match(first, /<figcaption>A useful article photo \(AP Photo\/Example\)<\/figcaption>/);
    assert.doesNotMatch(first, /<\/figure><p>A useful article photo/);
});
