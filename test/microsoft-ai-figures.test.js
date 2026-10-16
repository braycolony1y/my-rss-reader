import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import MicrosoftAiSource, {
    extractMicrosoftAiFigures, restoreMicrosoftAiFigures,
    stripMicrosoftAiEncodedFigures
} from '../src/sources/MicrosoftAiSource.js';
import TechmemeSource from '../src/sources/TechmemeSource.js';
import { parseJinaReaderText, parseOpenCliMarkdown } from '../src/articles/reader-markdown.js';

const articleUrl = 'https://microsoft.ai/news/frontier-pre-training-at-microsoft-ai/';
const figure = Buffer.from('<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\';">'
    + '<style>svg{width:100%}</style><svg viewBox="0 0 200 100"><text x="8" y="30">Figure 1 model results</text></svg>'
    + '<!--' + 'figure-data-'.repeat(70) + '-->').toString('base64');
const secondFigure = Buffer.from('<meta http-equiv="Content-Security-Policy" content="default-src \'none\';">'
    + '<table><tr><td>MAI-Base-2</td><td>80B active</td></tr></table>'
    + ' '.repeat(580)).toString('base64');

test('Microsoft AI recognizes and retains two real self-contained chart payloads', () => {
    assert.match(figure, /^PG1ldGEg/);
    const input = 'Figure 1 compares performance.' + figure
        + ' Model weights can be licensed. ' + secondFigure
        + ' The pre-training dataset grew.';
    const extracted = extractMicrosoftAiFigures(input);
    assert.equal(extracted.figures.length, 2);
    assert.doesNotMatch(extracted.markdown, /PG1ldGEg/);
    assert.match(extracted.markdown, /Figure 1 compares performance/);
    assert.match(extracted.markdown, /Model weights can be licensed/);
    assert.match(extracted.markdown, /The pre-training dataset grew/);
    const rendered = restoreMicrosoftAiFigures(extracted.markdown.replace(
        /(RSSMICROSOFTAIFIGURE\d+PLACEHOLDER)/g, '<p>$1</p>'
    ), extracted.figures);
    assert.equal((rendered.match(/class="microsoft-ai-figure"/g) || []).length, 2);
    assert.equal((rendered.match(/data-microsoft-ai-data="/g) || []).length, 2);
    assert.equal(stripMicrosoftAiEncodedFigures(rendered), rendered);
});

test('both Jina and OpenCLI preserve Microsoft AI chart figures after Markdown cleanup', () => {
    const body = '## How MAI-Base-2 Compares\n\n'
        + 'Figure 1 shows the performance of the models.\n\n'
        + figure + '\n\n'
        + '## Scaling science\n\n'
        + 'Models improve with larger training runs.\n\n' + secondFigure
        + '\n\nThe dataset includes vision.';
    const outputs = [
        parseJinaReaderText('Title: Frontier Pre-training at Microsoft AI\n\nMarkdown Content:\n' + body, articleUrl),
        parseOpenCliMarkdown('# Frontier Pre-training at Microsoft AI\n\n' + body, articleUrl)
    ];
    for (const result of outputs) {
        assert.equal((result.content.match(/class="microsoft-ai-figure"/g) || []).length, 2);
        assert.match(result.content, /Figure 1 shows the performance/);
        assert.match(result.content, /Models improve with larger training runs/);
        assert.match(result.content, /The dataset includes vision/);
        assert.doesNotMatch(result.content, /RSSMICROSOFTAIFIGURE\d+PLACEHOLDER/);
    }
    assert.equal(new MicrosoftAiSource().cleanCachedArticleContent(outputs[0].content, { url: articleUrl }), outputs[0].content);
});

test('Techmeme preserves Microsoft AI figures across nested article and cached reads', async () => {
    const url = 'https://www.techmeme.com/261015/p59';
    const story = '<article class="techmeme-story" data-techmeme-story-id="261015p59"'
        + ' data-techmeme-main-url="' + articleUrl + '" data-techmeme-publisher="Microsoft AI">'
        + '<header class="techmeme-main-story"><h2><a href="' + articleUrl
        + '">MAI-Base-2</a></h2></header></article>';
    const primaryContent = parseOpenCliMarkdown('# Frontier Pre-training at Microsoft AI\n\n'
        + 'Figure 1 shows the results.\n\n' + figure + '\n\n'
        + 'The scientific method shapes models. '.repeat(20), articleUrl).content;
    const source = new TechmemeSource();
    const expanded = await source.expandArticleResult({ url, content: story }, {
        url,
        fetchPrimaryArticle: async () => ({ url: articleUrl, content: primaryContent })
    });
    assert.equal(expanded.primaryArticleFetched, true);
    assert.match(expanded.content, /microsoft-ai-figure/);
    assert.match(expanded.content, /data-microsoft-ai-data="PG1ldGEg/);
    const cached = source.cleanCachedArticleContent(expanded.content, { url });
    assert.match(cached, /data-microsoft-ai-data="PG1ldGEg/);
    assert.equal(source.cleanCachedArticleContent(cached, { url }), cached);
});

test('Microsoft AI figure hydration uses lazy opaque-origin sandbox frames', () => {
    const embeds = readFileSync(new URL('../public/js/article/embeds.js', import.meta.url), 'utf8');
    const overlay = readFileSync(new URL('../public/js/article/overlay.js', import.meta.url), 'utf8');
    assert.match(embeds, /hydrateMicrosoftAiFigures\(root = document\)/);
    assert.match(embeds, /frame\.setAttribute\('sandbox', 'allow-scripts'\)/);
    assert.match(embeds, /frame\.setAttribute\('loading', 'lazy'\)/);
    assert.match(embeds, /frame\.src = 'data:text\/html;base64,' \+ encoded/);
    assert.equal((overlay.match(/this\.hydrateMicrosoftAiFigures\(/g) || []).length, 2);
});
