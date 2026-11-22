import assert from 'node:assert/strict';
import test from 'node:test';
import MicrosoftAiSource, {
    isMicrosoftAiArticleUrl,
    stripMicrosoftAiEncodedFigures
} from '../src/sources/MicrosoftAiSource.js';

const url = 'https://microsoft.ai/news/frontier-pre-training-at-microsoft-ai/';
const encodedFigure = Buffer.from('<meta http-equiv="Content-Security-Policy" content="default-src none;">'
    + '<style>svg{display:block}</style>' + 'x'.repeat(2048)).toString('base64');

test('Microsoft AI figure cleanup removes encoded iframe HTML without removing article prose', () => {
    assert.match(encodedFigure, /^PG1ldGEg/);
    const input = '<h2>Frontier Pre-training at Microsoft AI</h2>'
        + '<p>Figure 1 shows model performance. ' + encodedFigure + '</p>'
        + '<p>Owning our model pipeline end-to-end allows Microsoft to serve customers.</p>'
        + '<p>Figure 2 shows scaling. ' + encodedFigure + '</p>'
        + '<p>Across these held-out evaluations, MAI-Base-2 achieves lower BPB.</p>';
    const cleaned = stripMicrosoftAiEncodedFigures(input);
    assert.doesNotMatch(cleaned, /PG1ldGEg|Content-Security-Policy/);
    assert.match(cleaned, /Figure 1 shows model performance/);
    assert.match(cleaned, /Figure 2 shows scaling/);
    assert.match(cleaned, /Owning our model pipeline end-to-end/);
    assert.match(cleaned, /MAI-Base-2 achieves lower BPB/);
    assert.equal(stripMicrosoftAiEncodedFigures(cleaned), cleaned);
    assert.ok(cleaned.length < input.length / 3);
});

test('Microsoft AI cleanup handles encoded data URI and reader Markdown while leaving other sites alone', () => {
    const source = new MicrosoftAiSource();
    const markdown = 'Figure 1 shows performance.\n\n'
        + 'data:text/html;base64,' + encodedFigure + '\n\n'
        + '## How MAI-Base-2 Compares\n\nActual research text.';
    assert.equal(source.match('microsoft.ai'), true);
    assert.equal(source.match('notmicrosoft.ai'), false);
    assert.equal(isMicrosoftAiArticleUrl(url), true);
    assert.equal(isMicrosoftAiArticleUrl('https://microsoft.ai/'), false);
    assert.equal(isMicrosoftAiArticleUrl('https://evil.example/news/frontier-pre-training-at-microsoft-ai/'), false);
    const fromJina = source.parseJinaReaderText(markdown, { url });
    assert.equal(fromJina.markdown, source.parseOpenCliMarkdown(markdown, { url }).markdown);
    assert.doesNotMatch(fromJina.markdown, /base64,|PG1ldGEg/);
    assert.match(fromJina.markdown, /## How MAI-Base-2 Compares/);
    assert.match(fromJina.markdown, /Actual research text/);
    assert.equal(source.cleanCachedArticleContent(markdown, { url }), fromJina.markdown);
    assert.equal(source.cleanCachedArticleContent(markdown, { url: 'https://other.example/article' }), markdown);
    const enhanced = source.enhanceArticleResult({ url, content: markdown, title: 'MAI-Base-2' });
    assert.equal(enhanced.content, fromJina.markdown);
    assert.equal(source.enhanceArticleResult(enhanced), enhanced);
});
