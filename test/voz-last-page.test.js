import test from 'node:test';
import assert from 'node:assert/strict';
import { createArticleArchives } from '../src/articles/archives.js';

const base = 'https://voz.vn/t/example.275528';
const content = '<div class="voz-post">Reply</div>';
const service = createArticleArchives({
    cache: { get _articleCacheIndex() { throw new Error('Must not inspect the archive'); } },
    _initArticleCacheIndex: async () => { throw new Error('Must not initialize the archive'); },
    getLastKnownCachedArticle: async () => { throw new Error('Must not read other pages'); }
});

test('last-page validation is independent of total thread and archive size', async () => {
    for (const page of [1, 416, 10000]) {
        assert.equal(await service.shouldRevalidateUnderfilledVozPage(`${base}/page-${page}`, { content, pagination: { currentPage: page, pages: [{ page }] } }), false);
    }
});

test('page-local pagination still rejects a truncated nonfinal page', async () => {
    for (const pagination of [{ nextUrl: `${base}/page-417` }, { pages: [{ page: 417 }] }]) {
        assert.equal(await service.shouldRevalidateUnderfilledVozPage(`${base}/page-416`, { content, pagination }), true);
    }
});

test('a full random page needs no archive scan', async () => {
    assert.equal(await service.shouldRevalidateUnderfilledVozPage(`${base}/page-200`, { content: content.repeat(20) }), false);
});

test('protected deleted pages remain readable without revalidation', async () => {
    assert.equal(await service.shouldRevalidateUnderfilledVozPage(`${base}/page-416`, { content, sourceDeleted: true, pagination: { nextUrl: `${base}/page-417` } }), false);
});

test('deletion checks read flags rather than rebuilding two thread pages', async () => {
    const reads = [];
    const service = createArticleArchives({
        getCachedArticle: async () => { throw new Error('Must not render cached bodies'); },
        getCachedArticleMetadata: async url => { reads.push(url); return { sourceDeleted: url === base }; }
    });
    assert.equal(await service.isProtectedDeletedSourceSnapshot(`${base}/page-416`), true);
    assert.deepEqual(reads, [`${base}/page-416`, base]);
});
