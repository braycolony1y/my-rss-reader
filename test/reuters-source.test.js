import assert from 'node:assert/strict';
import test from 'node:test';
import ReutersSource, { cleanReutersReaderMarkdown } from '../src/sources/ReutersSource.js';

const reutersUrl = 'https://www.reuters.com/world/europe/spains-pm-sanchez-says-no-evidence-morocco-orchestrated-ceuta-border-surge-2026-09-03/';

test('Reuters OpenCLI reads wait for verification but reject a persistent interstitial', () => {
    const source = new ReutersSource();
    assert.equal(source.match('www.reuters.com'), true);
    assert.equal(source.getOpenCliWaitSeconds(), 15);
    assert.equal(source.needsOpenCliDiagnostics(), true);
    assert.deepEqual(source.getOpenCliFallbackReaderUrls(reutersUrl), [
        'https://www.usnews.com/news/world/articles/2026-09-03/spains-pm-sanchez-says-no-evidence-morocco-orchestrated-ceuta-border-surge'
    ]);
    assert.equal(source.isUsableArticleResult({ content: `<p>MADRID, Sept 3 (Reuters) - ${'A complete Reuters report. '.repeat(30)}</p>` }), true);
    assert.equal(source.isUsableArticleResult({
        content: '<h2>Verifying the device...</h2><p>The requested content will be available after verification.</p>'
    }), false);
});

test('Reuters syndication cleanup keeps the full report, photo, and section headings', () => {
    const image = 'https://www.usnews.com/object/image/reuters-photo.jpg?size=responsive640';
    const dirty = `
# Spain headline

By Reuters

![Reuters](${image})

Reuters

Spain's prime minister speaks in parliament. REUTERS/Example

Advertisement · Scroll to continue

Get a look at the day ahead with the Morning Bid Europe newsletter.

MADRID, Sept 3 (Reuters) - ${'The full opening paragraph is available. '.repeat(8)}

[1/3] Spain's prime minister speaks in parliament. REUTERS/Example Purchase Licensing Rights, opens new tab

FEWER POLICE THAN USUAL AT BORDER

${'The second section contains the rest of the Reuters report. '.repeat(8)}

Our Standards: The Thomson Reuters Trust Principles., opens new tab

Purchase Licensing Rights

**Copyright 2026 Thomson Reuters**.

## Join the Conversation

This publisher footer must be removed.
`;
    const cleaned = cleanReutersReaderMarkdown(dirty);

    assert.equal(cleaned.author, 'Reuters');
    assert.equal(cleaned.image, image);
    assert.match(cleaned.imageCaption, /prime minister speaks in parliament/);
    assert.doesNotMatch(cleaned.imageCaption, /Item|Purchase Licensing Rights/);
    assert.match(cleaned.markdown, /^MADRID, Sept 3 \(Reuters\) -/);
    assert.match(cleaned.markdown, /## FEWER POLICE THAN USUAL AT BORDER/);
    assert.doesNotMatch(cleaned.markdown, /Copyright|Join the Conversation|publisher footer|Advertisement|Morning Bid|Purchase Licensing|Our Standards/);
});

test('Reuters datelines tolerate invisible spacing and stop at reporting credits', () => {
    const dirty = `By Reuters\n\nSaveAdd us on\n\n### 来自 iframe: example\n\nWASHINGTON, Sept \u20604 (Reuters) - A short \u200breport.\n\nA second paragraph.\n\nThe Reuters Daily Briefing newsletter provides news. Sign up here.\n\n(Reporting \u2060by Jane Reporter; Editing by Editor)\n\nCopyright 2026 Thomson Reuters\n\n## Read Next\n\n[\n\n](https://example.com/unrelated)`;
    const result = cleanReutersReaderMarkdown(dirty);
    assert.match(result.markdown, /^WASHINGTON, Sept 4 \(Reuters\) - A short report\./);
    assert.match(result.markdown, /A second paragraph/);
    assert.match(result.markdown, /Reporting by Jane Reporter/);
    assert.doesNotMatch(result.markdown, /newsletter|Read Next|Copyright|iframe|SaveAdd|\u200b|\u2060/);
});

test('cached Reuters reports discard newsletter and broken footer markup without losing body links', () => {
    const source = new ReutersSource();
    const dirty = `<p>By Reuters</p><p>WASHINGTON, Sept &#x2060;4 (Reuters) - Opening.</p><p>The Reuters Power Up newsletter is available. Sign up <a href="https://example.com/signup">here</a>.</p><h3>BODY SECTION</h3><p>Body with <a href="https://example.com/company">Company, opens new tab</a>.</p><p>Reporting by Jane Reporter; Editing by Editor</p><p>[</p><p>](https://example.com/author)</p><h3>Read Next</h3><p>Unrelated story</p>`;
    const cleaned = source.cleanCachedArticleContent(dirty);
    assert.match(cleaned, /^<p>WASHINGTON, Sept 4/);
    assert.match(cleaned, /BODY SECTION/);
    assert.match(cleaned, /href="https:\/\/example.com\/company">Company<\/a>/);
    assert.match(cleaned, /Reporting by Jane Reporter/);
    assert.doesNotMatch(cleaned, /newsletter|Read Next|Unrelated|example.com\/author|opens new tab|&#x2060;/);
    assert.equal(source.cleanCachedArticleContent(cleaned), cleaned);
});
