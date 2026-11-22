import assert from 'node:assert/strict';
import test from 'node:test';
import CnbcSource, { cleanCnbcReaderMarkdown } from '../src/sources/CnbcSource.js';

const markdown = `
# Anthropic changes data retention policy

> 作者: @CNBC

[Ashley Capoot](https://www.cnbc.com/ashley-capoot/)

Key Points

- Anthropic changed its data retention policy.
- Customers can choose a different setting.

![Anthropic office](https://image.cnbcfm.com/api/v1/image/108000000-hero.jpg?v=1&w=1600&h=900)

Anthropic co-founder speaks at an event in 2025.
Chance Yeh | Getty Images Entertainment | Getty Images

Anthropic said the change will give users more control over their data while preserving enterprise safeguards.

The company said the new controls will roll out to customers this month and will remain configurable.

**WATCH:** CNBC video promotion

## Read more CNBC tech news

Navigation and unrelated recommendations.
`;

test('CNBC reader cleanup keeps the article and removes recommendations', () => {
    const source = new CnbcSource();
    const cleaned = cleanCnbcReaderMarkdown(markdown);
    assert.equal(source.match('www.cnbc.com'), true);
    assert.equal(cleaned.author, 'Ashley Capoot');
    assert.match(cleaned.image, /image\.cnbcfm\.com/);
    assert.match(cleaned.imageCaption, /Anthropic co-founder.+Getty Images/);
    assert.match(cleaned.markdown, /Anthropic said the change/);
    assert.doesNotMatch(cleaned.markdown, /WATCH:|Read more CNBC|Navigation/);
    assert.doesNotMatch(cleaned.markdown, /108000000-hero/);
});

test('CNBC uses publisher metadata instead of guessing an inline topic as the author', () => {
    const cleaned = cleanCnbcReaderMarkdown(markdown.replace('[Ashley Capoot](https://www.cnbc.com/ashley-capoot/)', ''));
    assert.equal(cleaned.author, 'CNBC');
});

test('CNBC supplies a safe publisher byline when reader metadata omits the reporter', () => {
    const cleaned = cleanCnbcReaderMarkdown(markdown
        .replace('[Ashley Capoot](https://www.cnbc.com/ashley-capoot/)', '')
        .replace('> 作者: @CNBC', '')
        .replace('Anthropic said the change', '[artificial intelligence](https://www.cnbc.com/ai-artificial-intelligence/) said the change'));
    assert.equal(cleaned.author, 'CNBC');
});
