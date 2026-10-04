import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createBoardCache } from '../src/board/cache-service.js';
import { canonicalIdentity } from '../src/board/thread-model.js';

const url = 'https://voz.vn/t/reactivation.123/';
const id = canonicalIdentity(url);
const feedUrl = 'https://voz.vn/forums/test/index.rss';
const article = { link: url, title: 'Thread', feedUrl, pubDate: '2026-10-01T00:00:00Z' };
async function fixture(t) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'idle-reactivation-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    let time = Date.parse('2026-10-04T12:00:00Z');
    const values = { boardStates: [url], userPreferences: { boardFolderMappings: { [url]: 'cache' } },
        cacheMembers: { [id]: { thread_id: id, url, article, in_cache: true, active_caching: true } } };
    const state = { calls: [], fresh: false, fail: false, incomplete: false, beforeFetch: null };
    const db = { get: async key => structuredClone(values[key]), put: async (key, data) => { values[key] = JSON.parse(data); },
        putMany: async pairs => { for (const [key, data] of Object.entries(pairs)) values[key] = JSON.parse(data); } };
    const service = createBoardCache({ env: { RSS_DATA: db }, directory, now: () => time,
        writeJson: (file, data) => fs.writeFile(file, JSON.stringify(data)),
        fetchPage: async link => {
            state.calls.push(link);
            if (state.beforeFetch) await state.beforeFetch();
            if (state.fail) throw new Error('Offline');
            const page = link.includes('page-2') ? 2 : 1;
            return { content: '<p>Thread</p>', threadSnapshot: { complete: !state.incomplete, currentPage: page, pageCount: 2,
                posts: [{ thread_id: id, post_id: String(page === 2 && state.fresh ? 30 : page * 10),
                    current_content: '<p>Post</p>', current_position: page, current_page: page,
                    created_at: page === 2 && state.fresh ? new Date(time - 60000).toISOString() : '2026-10-01T00:00:00Z' }] } };
        } });
    await service.initialize();
    await service.syncOne(id);
    assert.equal(values.cacheMembers[id].stop_reason, 'verified_idle_24h');
    state.calls.length = 0;
    return { service, state, values, advance: () => { time += 6 * 60000; } };
}

test('unchanged feed does one tail check, remains paused across ticks; changed feed resumes and archives new post', async t => {
    const { service, state, values, advance } = await fixture(t);
    await service.observe([article]);
    assert.equal(state.calls.length, 2);
    advance();
    await service.observe([article]);
    await service.tick();
    await service.tick();
    assert.equal(state.calls.length, 2);
    state.fresh = true;
    await service.observe([{ ...article, pubDate: '2026-10-04T12:05:00Z' }]);
    assert.equal(values.cacheMembers[id].active_caching, true);
    assert.equal(values.cacheMembers[id].stop_reason, null);
    assert.ok((await service.archive(url)).posts['30']);
});

test('opening an idle archive verifies the tail and returns newly captured posts', async t => {
    const { service, state, values } = await fixture(t);
    state.fresh = true;
    const payload = await service.articlePage(url);
    assert.equal(payload.active_caching, true);
    assert.equal(values.cacheMembers[id].stop_reason, null);
    assert.ok((await service.archive(url)).posts['30']);
});

test('reader checks coalesce and unchanged reads are throttled without enabling cron', async t => {
    const { service, state, values } = await fixture(t);
    await Promise.all([service.articlePage(url), service.articlePage(url)]);
    await service.articlePage(url);
    await service.tick();
    assert.equal(state.calls.length, 2);
    assert.equal(values.cacheMembers[id].active_caching, false);
});

test('manual pauses, removed membership and source-removed states never auto-resume', async t => {
    const { service, state, values } = await fixture(t);
    state.fresh = true;
    for (const reason of ['manual_pause', 'source_removed']) {
        values.cacheMembers[id].stop_reason = reason;
        await service.observe([article]);
        await service.articlePage(url);
    }
    values.cacheMembers[id].stop_reason = 'verified_idle_24h';
    values.cacheMembers[id].in_cache = false;
    await service.observe([article]);
    await service.articlePage(url);
    assert.equal(state.calls.length, 0);
});

test('manual pause during verification wins; manual pause during scan retains its reason', async t => {
    const { service, state, values } = await fixture(t);
    state.fresh = true;
    state.beforeFetch = async () => { state.beforeFetch = null; await service.setActive(url, false); };
    await service.articlePage(url);
    assert.equal(values.cacheMembers[id].stop_reason, 'manual_pause');
    assert.equal(values.cacheMembers[id].active_caching, false);
    values.cacheMembers[id].active_caching = true;
    values.cacheMembers[id].stop_reason = null;
    state.beforeFetch = async () => { state.beforeFetch = null; await service.setActive(url, false); };
    await service.syncOne(id);
    assert.equal(values.cacheMembers[id].stop_reason, 'manual_pause');
});

test('failed or incomplete probes preserve pause and archived content', async t => {
    const { service, state, values, advance } = await fixture(t);
    state.fail = true;
    assert.ok(await service.articlePage(url));
    advance();
    state.fail = false;
    state.incomplete = true;
    state.fresh = true;
    assert.ok(await service.articlePage(url));
    assert.equal(values.cacheMembers[id].stop_reason, 'verified_idle_24h');
    assert.equal(values.cacheMembers[id].active_caching, false);
});

test('feed reappearance or upward ordering can trigger verification even without a new RSS date', async t => {
    const { service, state, advance } = await fixture(t);
    const other = { ...article, link: 'https://voz.vn/t/other.456/' };
    await service.observe([other, article]);
    advance();
    await service.observe([article, other]);
    assert.equal(state.calls.length, 4);
    await service.observe([other]);
    advance();
    state.fresh = true;
    await service.observe([other, article]);
    assert.equal((await service.status()).members[id].active_caching, true);
});

test('a feed bump during cooldown remains eligible on the next ingestion', async t => {
    const { service, state, values, advance } = await fixture(t);
    await service.observe([article]);
    state.fresh = true;
    const bumped = { ...article, pubDate: '2026-10-04T12:01:00Z' };
    await service.observe([bumped]);
    assert.equal(state.calls.length, 2);
    assert.equal(values.cacheMembers[id].active_caching, false);
    advance();
    await service.observe([bumped]);
    assert.equal(values.cacheMembers[id].active_caching, true);
});
