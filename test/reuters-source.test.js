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
