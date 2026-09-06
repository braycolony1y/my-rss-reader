import { readServerSource } from './helpers/server-source.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parseOpenCliSearchDestination } from '../server.js';

const server = readServerSource();
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
    assert.match(server, /decodeGoogleNewsIndividually\(googleDecoder, uncached\)/);
    assert.match(server, /isGoogleNewsHostedThumbnail\(article\.image\)/);
    assert.match(server, /`\/api\/og-image\?url=\$\{encodeURIComponent\(article\.link\)\}`/);
    assert.match(smartNews, /helpers\s*\.resolveSmartArticleDestinations/);
});

import { matchesGoogleNewsPublisher, decodeGoogleNewsIndividually, repairGoogleNewsRecord } from '../src/google-news-destination.js';

const reutersFeed = 'https://news.google.com/rss/search?q=site%3Areuters.com';
test('Reuters search entries reject unrelated Vietnamese sites and lookalike hosts', () => {
    for (const link of ['https://znews.vn/haaland-post1681276.html', 'https://en.sggp.org.vn/business-dissolutions-tag141299.html', 'https://reuters.com.example.org/story']) {
        assert.equal(matchesGoogleNewsPublisher(link, { feedUrl: reutersFeed }), false);
    }
    assert.equal(matchesGoogleNewsPublisher('https://www.reuters.com/world/story', { feedUrl: reutersFeed }), true);
});

test('independent decoding preserves source identity when another URL fails', async () => {
    const decoder = { async decode(url) { if (url === 'bad') throw Error('blocked'); return { status: true, decoded_url: 'https://publisher/' + url }; } };
    const results = await decodeGoogleNewsIndividually(decoder, ['first', 'bad', 'third']);
    assert.deepEqual(results.map(r => [r.source_url, r.decoded_url]), [['first', 'https://publisher/first'], ['bad', undefined], ['third', 'https://publisher/third']]);
});

test('stored mismatched cluster promotes a valid source with its own image and category', () => {
    const bad = { link: 'https://znews.vn/haaland.html', feedUrl: reutersFeed, title: 'Reuters politics', image: 'haaland.jpg', smartCategory: 'news_vietnam' };
    const good = { link: 'https://bbc.co.uk/news/politics', title: 'Politics', image: 'politics.jpg', smartCategory: 'news_world', feedTitle: 'BBC' };
    const repaired = repairGoogleNewsRecord({ ...bad, relatedArticles: [good] });
    assert.equal(repaired.link, good.link);
    assert.equal(repaired.image, good.image);
    assert.equal(repaired.smartCategory, 'news_world');
    assert.equal(repaired.clusterCount, 1);
    assert.equal(repairGoogleNewsRecord(bad), null);
});
