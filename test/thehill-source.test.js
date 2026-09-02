import assert from 'node:assert/strict';
import test from 'node:test';
import TheHillSource, { theHillOpenCliUrl } from '../src/sources/TheHillSource.js';

const articleUrl = 'https://thehill.com/homenews/state-watch/6064333-florida-flock-camera-state-highway-removal/';

test('The Hill uses its public AMP article for OpenCLI while preserving the canonical URL', () => {
    const source = new TheHillSource();
    assert.equal(source.match('www.thehill.com'), true);
    assert.equal(source.match('example.com'), false);
    assert.equal(source.getOpenCliReaderUrl(articleUrl), `${articleUrl}amp/`);
    assert.equal(theHillOpenCliUrl('https://thehill.com/feed/'), 'https://thehill.com/feed/');
});

test('The Hill accepts a full AMP article and rejects press-and-hold challenge content', () => {
    const source = new TheHillSource();
    assert.equal(source.isUsableArticleResult({
        content: `<p>${'Florida is halting use of automated license plate readers on state highways. '.repeat(12)}</p>`
    }), true);
    assert.equal(source.isUsableArticleResult({
        content: '<p>Before we continue...</p><p>Press &amp; Hold to confirm you are a human (and not a bot).</p><p>Reference ID 8ba9665a-a69c-11f1-944f-ce4969283d14</p>'
    }), false);
});
