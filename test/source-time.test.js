import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from 'cheerio';
import { absoluteTimestamp, sourceTimeMarkup, normalizeStoredPostTimes } from '../src/articles/source-time.js';
import { reconcilePosts, upgradeArchiveTimes } from '../src/board/thread-model.js';
import { renderArchive } from '../src/board/presentation.js';
const created='2026-09-07T03:42:00.000Z',captured='2026-09-07T04:00:00.000Z';
test('only absolute source timestamps are accepted; seconds and milliseconds agree',()=>{
    assert.equal(absoluteTimestamp('27 minutes ago'),null);
    assert.equal(absoluteTimestamp('2026-09-07 03:42'),null);
    assert.equal(absoluteTimestamp(created),created);
    assert.equal(absoluteTimestamp('2026-09-07T13:40:06+0700'),'2026-09-07T06:40:06.000Z');
    assert.equal(absoluteTimestamp('2026-09-07T01:40:06-0500'),'2026-09-07T06:40:06.000Z');
    assert.equal(absoluteTimestamp(Date.parse(created)),created);
    assert.equal(absoluteTimestamp(Date.parse(created)/1000),created);
});
test('missing source date retains internal provenance without cache labels through repeated reads',()=>{
    let html='<div class="voz-post"><div class="voz-post-info"><span class="voz-post-time">27 minutes ago</span></div></div>';
    html=normalizeStoredPostTimes(html,{cached_at:captured});
    html=normalizeStoredPostTimes(html,{cached_at:'2026-09-08T00:00:00Z'});
    assert.doesNotMatch(html,/First cached|Cached at|Cache time/);assert.match(html,/data-time-kind="cached"/);
    assert.match(html,new RegExp(captured));assert.doesNotMatch(html,/27 minutes ago|2026-09-08/);
});
test('unavailable posts retain source dates and use the same author/header layout as ordinary posts',()=>{
    const record={thread_id:'voz.vn:thread:123',url:'https://voz.vn/t/test.123'};
    const post={post_id:'7',author_name:'Author',created_at:created,edited_at:null,current_content:'Body',current_page:1,current_position:1,current_visible_number:1,permalink:record.url};
    reconcilePosts(record,[post],true,captured);
    reconcilePosts(record,[{...post,created_at:null}],false,'2026-09-07T05:00:00Z');
    reconcilePosts(record,[],true,'2026-09-07T06:00:00Z');upgradeArchiveTimes(record);
    assert.equal(record.posts['7'].source_created_at,created);
    assert.equal(record.posts['7'].cached_at,captured);
    assert.equal(record.posts['7'].removed_at,'2026-09-07T06:00:00Z');
    const $=load(renderArchive(record));
    assert.equal($('.voz-post-author-group .voz-post-author').text(),'@Author');
    assert.equal($('.voz-post-info time').attr('datetime'),created);
    assert.equal($('.voz-post-info time').attr('data-time-exact'),'false');
    assert.equal($('.voz-post-info .voz-post-index').length,1);
});
test('normal source time exposes exact date independently of live publisher access',()=>{
    const html=sourceTimeMarkup({source_created_at:created,cached_at:captured});
    assert.match(html,new RegExp(created));assert.doesNotMatch(html,new RegExp(captured));assert.match(html,/tabindex="0"/);
});

test('cache chip occupies the existing metadata row with no standalone card row',()=>{
    const $=load(readFileSync(new URL('../index.html',import.meta.url),'utf8'));
    assert.equal($('.cache-status-chip').parents('.article-metadata').length,1);
    assert.equal($('.cache-card-status').length,0);
});
