import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parseOpenCliSearchDestination } from '../server.js';

const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const smartNews = readFileSync(new URL('../smart-news.js', import.meta.url), 'utf8');

test('OpenCLI publisher search accepts only results from the expected publisher domain', () => {
    const output = JSON.stringify([
        { title: 'Wrong mirror', url: 'https://example.com/copied-story' },
        { title: 'AP story', url: 'https://apnews.com/article/gloria-steinem-dies-724836935f6547fda60f361c15238d14' }
    ]);
    assert.equal(
        parseOpenCliSearchDestination(output, 'apnews.com'),
        'https://apnews.com/article/gloria-steinem-dies-724836935f6547fda60f361c15238d14'
    );
});

test('OpenCLI publisher search rejects malformed output and Google News wrappers', () => {
    assert.equal(parseOpenCliSearchDestination('not json', 'apnews.com'), '');
    assert.equal(parseOpenCliSearchDestination(JSON.stringify([
        { url: 'https://news.google.com/rss/articles/example?oc=5' }
    ]), 'apnews.com'), '');
});

test('Smart ingestion batch-resolves publisher destinations and replaces Google-hosted thumbnails', () => {
    assert.match(server, /async function resolveSmartArticleDestinations/);
    assert.match(server, /googleDecoder\.decodeBatch\(uncached\)/);
    assert.match(server, /isGoogleNewsHostedThumbnail\(article\.image\)/);
    assert.match(server, /`\/api\/og-image\?url=\$\{encodeURIComponent\(article\.link\)\}`/);
    assert.match(smartNews, /helpers\s*\.resolveSmartArticleDestinations/);
});
