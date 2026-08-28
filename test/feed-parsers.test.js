import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeHTMLEntities, normalizeArticleTitle, fastParseRSS } from '../feed-parsers.js';

test('normalizes nested HTML entities in feed titles', () => {
    assert.equal(normalizeArticleTitle('**Tự nhận &amp;#039;Top 1&amp;#039;**'), "Tự nhận 'Top 1'");
    assert.equal(decodeHTMLEntities('A &amp; B &mdash; C'), 'A & B — C');
    assert.equal(
        normalizeArticleTitle('Gi&aacute; USD h&ocirc;m nay 5.8.2026: Ng&acirc;n h&agrave;ng tiếp tục giảm, đ&ocirc; la tự do đứng y&ecirc;n'),
        'Giá USD hôm nay 5.8.2026: Ngân hàng tiếp tục giảm, đô la tự do đứng yên'
    );
});

test('parses RSS metadata, content, media, and comment counts', () => {
    const parsed = fastParseRSS(`
        <rss xmlns:media="http://search.yahoo.com/mrss/" xmlns:slash="http://purl.org/rss/1.0/modules/slash/">
          <channel>
            <title>Demo &amp; Feed</title>
            <item>
              <title><![CDATA[**A &amp; B**]]></title>
              <link>https://example.com/article</link>
              <pubDate>2026-08-04T00:00:00Z</pubDate>
              <description><![CDATA[<p>Hello <strong>world</strong></p>]]></description>
              <media:thumbnail url="https://example.com/image.jpg" />
              <slash:comments>12</slash:comments>
            </item>
          </channel>
        </rss>
    `);

    assert.equal(parsed.feedTitle, 'Demo & Feed');
    assert.equal(parsed.items.length, 1);
    assert.deepEqual(parsed.items[0], {
        title: 'A & B',
        link: 'https://example.com/article',
        pubDate: '2026-08-04T00:00:00Z',
        content: 'Hello world',
        imageUrl: 'https://example.com/image.jpg',
        replyCount: 12
    });
});

test('parses Atom links and namespaced content', () => {
    const parsed = fastParseRSS(`
        <feed>
          <title>Atom Feed</title>
          <entry>
            <title>Entry title</title>
            <link href="https://example.com/entry" />
            <updated>2026-08-04T01:00:00Z</updated>
            <content:encoded><![CDATA[<p>Entry body</p>]]></content:encoded>
          </entry>
        </feed>
    `);

    assert.equal(parsed.items[0].link, 'https://example.com/entry');
    assert.equal(parsed.items[0].content, 'Entry body');
});

test('removes copied markdown punctuation from publisher links during ingestion', () => {
    const parsed = fastParseRSS(`
        <rss><channel><title>Tiền Phong</title><item>
            <title>Article title</title>
            <link>https://tienphong.vn/story-post1870739.tpo)</link>
            <description>Article description</description>
        </item></channel></rss>
    `);

    assert.equal(parsed.items[0].link, 'https://tienphong.vn/story-post1870739.tpo');
});
