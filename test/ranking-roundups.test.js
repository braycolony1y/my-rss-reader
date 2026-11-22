import test from 'node:test';
import assert from 'node:assert/strict';
import { eventMatch, eventTokens, isRoundupTitle } from '../src/ranking/roundups.js';
import { rawAllowedDestinations } from '../src/ranking/destinations.js';

test('digest and roundup titles are recognised in English and Vietnamese', () => {
    for (const title of ['Morning news roundup', 'Daily news digest', 'Evening news briefing', 'Newsletter: the week in tech', 'Podcast: today in the news',
        'Tin nóng thế giới sáng 13/9/2026', 'Điểm tin buổi sáng', 'Bản tin thời sự hôm nay']) {
        assert.equal(isRoundupTitle(title), true, title);
    }
    for (const title of ['Central bank announces interest rate cut on Friday', 'OpenWrt confirms critical vulnerability in router firmware', 'Authorities order evacuation as cyclone reaches coast']) {
        assert.equal(isRoundupTitle(title), false, title);
    }
});

test('event token matching ignores filler words and numbers', () => {
    assert.ok(eventTokens('The latest news: Central bank cuts interest rate 2026').has('central'));
    assert.equal(eventTokens('latest news today').size, 0);
    const same = eventMatch('Central bank announces interest rate cut', 'Central bank cuts interest rate again');
    const different = eventMatch('Central bank announces interest rate cut', 'Volcano erupts near island resort');
    assert.ok(same.similarity > different.similarity);
    assert.equal(different.shared, 0);
});

test('configured source destinations drive eligibility', () => {
    const sources = [{ url: 'https://a.test/rss', category: 'tech', region: 'vietnam' }, { url: 'https://b.test/rss', category: 'news', region: '' },
        { url: 'https://c.test/rss', category: 'finance', region: 'global', enabled: false }];
    assert.deepEqual(rawAllowedDestinations({ feedUrl: 'https://a.test/rss' }, sources), ['tech_vietnam']);
    assert.deepEqual(rawAllowedDestinations({ feedUrl: 'https://b.test/rss' }, sources), ['news_vietnam', 'news_global']);
    assert.deepEqual(rawAllowedDestinations({ feedUrl: 'https://c.test/rss' }, sources), []);
    assert.deepEqual(rawAllowedDestinations({ feedUrl: 'https://unknown.test/rss' }, sources), []);
});
