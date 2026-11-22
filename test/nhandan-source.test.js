import assert from 'node:assert/strict';
import test from 'node:test';
import NhanDanSource from '../src/sources/NhanDanSource.js';

test('Nhân Dân empty deletion snapshots are revalidated instead of permanently hidden', () => {
    const source = new NhanDanSource();
    assert.equal(source.requiresIndependentDeletionConfirmation(), true);
    assert.equal(source.shouldRevalidateDeletedSnapshot({
        sourceDeleted: true,
        sourceDeletedHasCache: false
    }), true);
    assert.equal(source.shouldRevalidateDeletedSnapshot({
        sourceDeleted: true,
        sourceDeletedHasCache: true
    }), false);
    assert.equal(source.isUsableArticleResult({
        content: '<p><img src="https://cdn.example/related.jpg"></p><h3>One related story only</h3>'
    }), false);
    assert.equal(source.isUsableArticleResult({
        content: `<p>${'Full Nhân Dân article paragraph. '.repeat(20)}</p>`
    }), true);
});
