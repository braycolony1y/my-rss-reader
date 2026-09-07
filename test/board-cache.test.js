import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { canonicalIdentity, extractThreadSnapshot, reconcilePosts, contentHash, extractLegacyPosts } from '../src/board/thread-model.js';
import { createBoardCache } from '../src/board/cache-service.js';
import { renderArchive } from '../src/board/presentation.js';
const url = 'https://voz.vn/t/sample.123/';
const id = canonicalIdentity(url);
const post = (post_id, content = 'Original', position = 1, page = 1) => ({ thread_id: id, post_id: String(post_id), author_id: '8', author_name: 'Alice', current_content: `<p>${content}</p>`, created_at: '2026-09-06T00:01:00Z', edited_at: null, current_page: page, current_position: position, current_visible_number: position, permalink: `https://voz.vn/p/${post_id}` });
const snapshot = (page, count, posts) => ({ content: '<p>Thread</p>', title: 'Test thread', threadSnapshot: { complete: true, currentPage: page, pageCount: count, posts } });

async function fixture(t, extra = {}) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rss-cache-test-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const values = { articles: [], boardStates: [], userPreferences: { boardFolders: ['cache'], boardFolderMappings: {} }, ...extra.values };
    const db = { get: async key => structuredClone(values[key]), put: async (key, value) => { values[key] = JSON.parse(value); }, putMany: async pairs => { for (const [key, value] of Object.entries(pairs)) values[key] = JSON.parse(value); } };
    let time = Date.parse('2026-09-06T00:00:00Z');
    const service = createBoardCache({ env: { RSS_DATA: db }, directory, now: () => time,
        writeJson: (file, data) => fs.writeFile(file, JSON.stringify(data)), fetchPage: extra.fetchPage || (async () => snapshot(1, 1, [post(10)])), ...extra.options });
    await service.initialize();
    return { service, values, advance: ms => { time += ms; } };
}
const membership = { boardStates: [url], userPreferences: { boardFolders: ['cache'], boardFolderMappings: { [url]: 'cache' } } };

test('thread identity ignores slug, page, latest/unread, post anchor and tracking', () => {
    for (const link of ['https://voz.vn/t/renamed.123/page-4#post-77', 'https://voz.vn/t/sample.123/unread', 'https://voz.vn/t/sample.123/latest?utm_source=x']) assert.equal(canonicalIdentity(link), id);
    assert.equal(canonicalIdentity('https://example.com/article?utm_source=x&b=2&a=1#reply'), 'https://example.com/article?a=1&b=2');
    assert.equal(canonicalIdentity('https://forum.test/threads/another-title.432/page-2'), 'forum.test:thread:432');
});

test('permanent IDs survive page/visible-number changes, edit, deletion and restoration', () => {
    const record = { thread_id: id };
    reconcilePosts(record, [post(10), post(30, 'Third', 3)], true, '2026-09-06T01:00:00Z');
    reconcilePosts(record, [post(10), post(30, 'Third', 2, 2)], true, '2026-09-06T02:00:00Z');
    assert.equal(Object.keys(record.posts).length, 2);
    assert.equal(record.posts['30'].versions.length, 1);
    assert.equal(record.posts['30'].current_visible_number, 2);
    reconcilePosts(record, [post(10, 'Edited')], false, '2026-09-06T03:00:00Z');
    assert.equal(record.posts['30'].is_removed, false);
    assert.equal(record.last_successful_sync_at, '2026-09-06T02:00:00Z');
    assert.equal(record.posts['10'].versions[0].content, '<p>Original</p>');
    reconcilePosts(record, [post(10, 'Edited')], true, '2026-09-06T04:00:00Z');
    assert.equal(record.posts['30'].is_removed, true);
    assert.equal(record.posts['30'].last_seen_at, '2026-09-06T02:00:00Z');
    assert.equal(record.posts['30'].removed_at, '2026-09-06T04:00:00Z');
    reconcilePosts(record, [post(10, 'Edited'), post(30, 'Third restored', 3)], true, '2026-09-06T05:00:00Z');
    assert.equal(record.posts['30'].is_removed, false);
    assert.equal(record.posts['30'].removed_at, null);
    assert.equal(record.posts['30'].versions.length, 2);
});

test('formatting, lazy-loading and reaction changes do not create content versions', () => {
    assert.equal(contentHash('<p class="one">Hello <b>world</b></p><img src="/a" loading="lazy">'), contentHash('<p class="two">Hello <b>world</b></p><img src="/a">'));
    assert.notEqual(contentHash('<a href="/a">link</a>'), contentHash('<a href="/b">link</a>'));
});

test('raw XenForo extraction uses data-content post IDs and records metadata', () => {
    const html = `<html><a href="/t/sample.123/page-3">3</a><article class="message message--post" data-content="post-901" data-author="Alice"><div class="message-userDetails"><a class="username" data-user-id="8">Alice</a></div><ul class="message-attribution-main"><li><time datetime="2026-09-06T00:01:00Z"></time></li></ul><ul class="message-attribution-opposite"><li><a href="/p/901">#2</a></li></ul><div class="message-body"><div class="bbWrapper"><p>Hello</p><img data-src="/image.jpg"><a href="/p/77">Earlier post</a></div></div><div class="message-lastEdit"><time data-time="1788652920"></time></div></article></html>`;
    const result = extractThreadSnapshot(html, url);
    assert.equal(result.pageCount, 3);
    assert.equal(result.complete, true);
    assert.equal(result.posts[0].post_id, '901');
    assert.equal(result.posts[0].author_id, '8');
    assert.equal(result.posts[0].current_visible_number, 2);
    assert.ok(result.posts[0].edited_at);
    assert.match(result.posts[0].current_content, /src="https:\/\/voz.vn\/image.jpg"/);
    assert.match(result.posts[0].current_content, /href="https:\/\/voz.vn\/p\/77"/);
    assert.equal(extractThreadSnapshot(html.replace('data-content="post-901"', ''), url).complete, false);
    assert.equal(extractLegacyPosts('<div class="voz-post" data-post-index="2">Unknown ID</div>', url).length, 0);
});

test('every sync visits old pages, detects edits/new posts on any page, and partial failure preserves missing posts', async t => {
    let run = 0, failing = false;
    const calls = [];
    const { service } = await fixture(t, { values: membership, fetchPage: async value => {
        const page = value.includes('page-2') ? 2 : 1; calls.push(page);
        if (page === 2 && failing) throw new Error('Network failed');
        return snapshot(page, 2, page === 1 ? [post(10, run ? 'Edited early page' : 'Original'), ...(run ? [post(20, 'New on page one', 2)] : [])] : [post(30, 'Last page', 3, 2)]);
    } });
    await service.tick(); run++;
    await service.tick();
    assert.deepEqual(calls, [1, 2, 1, 1, 2, 1]);
    let record = await service.archive(url);
    assert.equal(record.posts['10'].versions.length, 2);
    assert.ok(record.posts['20']);
    failing = true; await service.tick();
    record = await service.archive(url);
    assert.equal(record.sync_status, 'incomplete');
    assert.equal(record.posts['30'].is_removed, false);
});

test('pause persists across restart and stops synchronization without losing history', async t => {
    let count = 0;
    const { service, values } = await fixture(t, { values: membership, fetchPage: async () => { count++; return snapshot(1, 1, [post(10)]); } });
    await service.tick();
    await service.setActive(url, false);
    await service.tick();
    assert.equal(count, 1);
    assert.equal(values.cacheMembers[id].in_cache, true);
    assert.equal((await service.archive(url)).posts['10'].versions.length, 1);
    await service.initialize(); await service.tick();
    assert.equal(count, 1);
    await service.setActive(url, true); await service.syncOne(id);
    assert.equal(count, 2);
});

test('keyword phrases match title plus source only on new threads, never replies or old rediscovered threads', async t => {
    const old = { link: url, title: 'Apple Vision Pro', feedUrl: 'feed-A', pubDate: '2026-09-06T00:01:00Z' };
    const { service, values } = await fixture(t, { values: { articles: [old] } });
    await service.saveRules([{ keywords: ['Vision Pro'], source: 'feed-A', enabled: true }]);
    await service.observe([{ ...old, link: url + 'page-3', pubDate: '2026-09-06T00:02:00Z' }]);
    assert.equal(values.boardStates.length, 0);
    const fresh = { ...old, link: 'https://voz.vn/t/new.456/' };
    await service.observe([{ ...fresh, feedUrl: 'feed-B' }]);
    await service.observe([fresh]); // Existing identity becoming a source/title match is not a new article.
    assert.equal(values.boardStates.length, 0);
    await service.observe([{ ...fresh, link: 'https://voz.vn/t/new.789/' }]);
    assert.equal(values.boardStates.length, 1);
    assert.equal(values.cacheMembers['voz.vn:thread:789'].auto_added, true);
    await service.observe([{ ...fresh, link: 'https://voz.vn/t/new.789/page-9' }]);
    assert.equal(values.boardStates.length, 1);
});

test('dismissals extend on activity, expire and purge, without ever treating an old thread as new', async t => {
    const article = { link: url, title: 'New camera', feedUrl: 'feed-A' };
    const { service, values, advance } = await fixture(t);
    await service.saveRules([{ keywords: ['camera'], source: 'feed-A' }]);
    await service.observe([article]);
    values.boardStates = [];
    await service.reconcileMembership();
    assert.ok(values.cacheIdentityLedger.dismissals[id]);
    advance(29 * 86400000);
    await service.observe([{ ...article, link: url + 'page-2' }]);
    const expiry = values.cacheIdentityLedger.dismissals[id].expires_at;
    advance(2 * 86400000); await service.tick();
    assert.equal(values.cacheIdentityLedger.dismissals[id].expires_at, expiry);
    advance(29 * 86400000); await service.tick();
    assert.equal(values.cacheIdentityLedger.dismissals[id], undefined);
    await service.observe([article]);
    assert.equal(values.boardStates.length, 0);
    assert.ok((await service.archive(url)).posts['10']);
});

test('history button is hidden for one version, visible for edits, and archived HTML is sanitized', () => {
    const record = reconcilePosts({ thread_id: id }, [post(10)], true);
    assert.doesNotMatch(renderArchive(record), /View change history/);
    reconcilePosts(record, [post(10, '<img src="x" onerror="alert(1)"><script>bad()</script>Updated')], true);
    const html = renderArchive(record);
    assert.match(html, /View change history/);
    assert.doesNotMatch(html, /onerror|<script/);
});

test('an unseen old thread with a recent reply date is not auto-added', async t => {
    const { service, values } = await fixture(t, { fetchPage: async () => snapshot(1, 1, [{ ...post(10), created_at: '2020-01-01T00:00:00Z' }]) });
    await service.saveRules([{ keywords: ['camera'], enabled: true }]);
    await service.observe([{ link: url, title: 'camera', pubDate: '2026-09-06T00:01:00Z' }]);
    assert.equal(values.boardStates.length, 0);
    assert.equal(values.cacheIdentityLedger.articles[id].pending, undefined);
});

test('new-article capture retries a temporary reader failure, without reclassifying later activity', async t => {
    let failed = true;
    const { service, values } = await fixture(t, { fetchPage: async () => {
        if (failed) throw new Error('Temporary offline');
        return snapshot(1, 1, [post(10)]);
    } });
    await service.saveRules([{ keywords: ['camera'], enabled: true }]);
    await service.observe([{ link: url, title: 'camera' }]);
    assert.equal(values.boardStates.length, 0);
    assert.ok(values.cacheIdentityLedger.articles[id].pending);
    failed = false;
    await service.tick();
    assert.equal(values.boardStates.length, 1);
    assert.equal(values.cacheIdentityLedger.articles[id].pending, undefined);
});

test('pausing an in-flight scan prevents later page requests and deletion inference', async t => {
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const calls = [];
    const { service } = await fixture(t, { values: membership, fetchPage: async value => {
        calls.push(value);
        if (value.includes('page-2')) { await pending; return snapshot(2, 3, [post(30, 'Third', 3, 2)]); }
        return snapshot(1, 3, [post(10)]);
    } });
    const syncing = service.tick();
    while (calls.length < 2) await new Promise(resolve => setImmediate(resolve));
    await service.setActive(url, false);
    release(); await syncing;
    assert.equal(calls.length, 2);
    const record = await service.archive(url);
    assert.equal(record.sync_status, 'incomplete');
    assert.equal(record.active_caching, false);
});

test('migrated cached copies remain as historical versions after the first new scan', async t => {
    const { service } = await fixture(t, { values: membership, options: { loadLegacy: async () => [{ posts: [post(10, 'Legacy original')], content: '<p>Old full page</p>', captured_at: '2026-08-01T00:00:00Z' }] } });
    await service.tick();
    const record = await service.archive(url);
    assert.equal(record.posts['10'].versions.length, 2);
    assert.equal(record.posts['10'].versions[0].content, '<p>Legacy original</p>');
    assert.equal(record.posts['10'].versions[0].captured_at, '2026-08-01T00:00:00Z');
    assert.equal(record.legacy_snapshots[0].content, '<p>Old full page</p>');
});

test('atomic folder updates preserve other folders and create dismissals on removal', async t => {
    const { service, values } = await fixture(t);
    const article = { link: url, title: 'New camera' };
    await service.saveRules([{ keywords: ['camera'] }]);
    await service.observe([article]);
    await service.setFolder({ link: 'https://example.test/report', title: 'Report' }, 'Research / notes');
    assert.equal(values.userPreferences.boardFolderMappings[values.boardStates.find(link => link.includes('voz.vn'))], 'cache');
    await service.setFolder(article, null);
    assert.equal(values.cacheMembers[id].in_cache, false);
    assert.ok(values.cacheIdentityLedger.dismissals[id]);
    assert.equal(values.boardStates.length, 1);
    assert.equal(values.userPreferences.boardFolderMappings['https://example.test/report'], 'Research / notes');
    assert.ok((await service.archive(url)).posts['10']);
});

test('archive navigation returns only the requested page and retains removed posts and its page snapshots', async () => {
    const { archivePage } = await import('../src/board/presentation.js');
    const record = { thread_id: id, url, posts: { 10: post(10), 30: { ...post(30, 'Page two', 21, 2), is_removed: true } }, legacy_snapshots: [{ url, content: 'first' }, { url: url.replace(/\/$/,'')+'/page-2', content: 'second' }] };
    const first = archivePage(record, url);
    const second = archivePage(record, url+'page-2');
    assert.deepEqual(Object.keys(first.record.posts), ['10']);
    assert.deepEqual(Object.keys(second.record.posts), ['30']);
    assert.equal(second.record.posts['30'].is_removed, true);
    assert.equal(second.pagination.currentPage, 2);
    assert.equal(second.pagination.prevUrl, first.url);
    assert.equal(first.pagination.nextUrl, second.url);
    assert.equal(second.pagination.nextUrl, null);
    assert.equal(second.record.legacy_snapshots[0].content, 'second');
    assert.equal(Object.keys(record.posts).length, 2);
});

test('quote controls, attribution links, retina emoji and wrappers do not pretend to be edits', async () => {
    const { meaningfulVersions } = await import('../src/board/thread-model.js');
    const old = '<blockquote class="voz-quote"><div>Member said:</div><div>Hello <img class="smilie" src="https://data.voz.vn/smile_2x.png" alt=":smile:"></div></blockquote>Reply';
    const raw = '<blockquote><div><a class="bbCodeBlock-sourceJump" href="/goto/post?id=12">Member said:</a></div><div>Hello <img class="smilie" src="https://data.voz.vn/smile.png" alt=":smile:"></div><div class="bbCodeBlock-expandLink"><a>Click to expand...</a></div></blockquote>Reply';
    assert.equal(contentHash(old), contentHash(raw));
    const record = reconcilePosts({ thread_id:id, url }, [post(10, old)], true);
    reconcilePosts(record, [post(10, raw)], true);
    assert.equal(record.posts['10'].versions.length, 1);
    const persisted = { versions: [{content:old}, {content:raw}, {content:raw.replace('Reply','Edited reply')}] };
    assert.equal(meaningfulVersions(persisted,url).length, 2);
    assert.equal(persisted.versions.length, 3, 'original captures are never deleted');
});

test('archive renderer retains avatars and promotes lazy body images to usable absolute sources', () => {
    const record = reconcilePosts({thread_id:id,url}, [{...post(10,'<img data-src="/attachments/photo.jpg">'),author_avatar:'https://data.voz.vn/avatar.jpg'}],true);
    const html=renderArchive(record);
    assert.match(html,/src="https:\/\/data.voz.vn\/avatar.jpg"/);
    assert.match(html,/src="https:\/\/voz.vn\/attachments\/photo.jpg"/);
});

test('keywords normalize on save only, with case-insensitive deduplication', async t => {
    const {service,values} = await fixture(t,{values:{cacheAutoRules:[{id:'old',keywords:['Vingroup','VINGROUP',' PHẠM NHẬT VƯỢNG '],enabled:true}]}});
    assert.deepEqual(values.cacheAutoRules[0].keywords,['Vingroup','VINGROUP',' PHẠM NHẬT VƯỢNG '], 'startup does not rewrite rules');
    const rules=await service.saveRules([{keywords:['VinFast','VINFAST',' Green SM ']}]);
    assert.deepEqual(rules[0].keywords,['vinfast','green sm']);
});

test('post resume resolves the archived permanent ID even after renumbering', async()=>{
    const {archivePage}=await import('../src/board/presentation.js');
    const record={thread_id:id,url,posts:{10:post(10),30:post(30,'Moved',79,4)},legacy_snapshots:[]};
    const page=archivePage(record,url.replace(/\/$/,'')+'/post-30');
    assert.equal(page.pagination.currentPage,4);assert.deepEqual(Object.keys(page.record.posts),['30']);
});

test('confirmed removal changes cache status and stops syncing without erasing posts',async t=>{
    let removed=false;
    const {service,values}=await fixture(t,{values:membership,fetchPage:async()=>removed?{isDeletedSource:true}:snapshot(1,1,[post(10)])});
    await service.syncOne(id);removed=true;await service.syncOne(id);
    const record=await service.archive(url);
    assert.equal(record.source_removed,true);assert.ok(record.posts['10']);
    assert.equal(values.cacheMembers[id].active_caching,false);
    assert.equal(values.cacheMembers[id].source_removed,true);
});

test('temporary fetch errors do not conclude that a source was removed',async t=>{
    const {service,values}=await fixture(t,{values:membership,fetchPage:async()=>{throw Error('Timeout')}});
    await service.syncOne(id);
    assert.equal(values.cacheMembers[id].source_removed,false);
    assert.equal(values.cacheMembers[id].active_caching,true);
    assert.equal(values.cacheMembers[id].sync_status,'incomplete');
});

test('Board deduplicates thread URL variants without merging separate threads with identical titles',async()=>{
    const {deduplicateBoardArticles}=await import('../src/routes/data-routes.js');
    const list=deduplicateBoardArticles([{link:url,title:'Same'},{link:url+'unread',title:'Same',image:'photo.jpg'},{link:'https://voz.vn/t/other.456',title:'Same'}]);
    assert.equal(list.length,2);assert.equal(list[0].image,'photo.jpg');
});
