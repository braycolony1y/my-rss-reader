import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmFeedback, getPersonalStore, undoFeedback, PERSONAL_STATE_KEY } from '../src/smart/feedback/store.js';
import { semantics } from '../src/smart/feedback/semantics.js';
import { filterPublishedView } from '../src/smart/prefilter/published-view.js';

test('published personal decisions commit together, preserve sections and Undo, and retry failed persistence', async () => {
    let writes = 0, fail = false;
    const data = new Map();
    const db = { async get(key) { return data.get(key); }, async put(key, value) {
        if (fail) throw Error('disk failure');
        writes++; data.set(key, JSON.parse(value));
    } };
    const article = (id, section = 'tech_vietnam') => ({ title: `VinFast monthly deliveries increase ${id}`,
        link: `https://example.test/${id}`, content: 'Monthly vehicle delivery numbers.', topStory: { feed: section } });
    const seed = article('seed');
    const event = await confirmFeedback(db, { article: seed, surface: 'smart_top',
        selectedReasons: [semantics.pool(seed).find(reason => reason.rule.dimension === 'entity')] });
    const excluded = Array.from({ length: 20 }, (_, i) => article(i));
    excluded[0].feedbackSection = 'news_vietnam';
    const kept = [article('different-section', 'news_vietnam'), { ...article('major'), title: 'VinFast files for bankruptcy' }];
    const snapshot = { articles: [...excluded, ...kept] };
    const before = (await getPersonalStore(db)).state;
    fail = true;
    await assert.rejects(filterPublishedView(db, snapshot), /disk failure/);
    assert.equal((await getPersonalStore(db)).state, before);
    fail = false; writes = 0;
    assert.deepEqual((await filterPublishedView(db, snapshot)).articles, kept);
    assert.equal(writes, 1);
    assert.equal(data.get(PERSONAL_STATE_KEY).decisions.length, 21);
    assert.deepEqual((await filterPublishedView(db, snapshot)).articles, kept);
    assert.deepEqual((await filterPublishedView(db, snapshot)).articles, kept);
    assert.equal(writes, 1);
    await undoFeedback(db, event.id);
    assert.equal(await filterPublishedView(db, snapshot), snapshot);
});
