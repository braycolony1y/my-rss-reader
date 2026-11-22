import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from 'cheerio';
import VozSource from '../src/sources/VozSource.js';
import { escapePostText, sanitizePostMarkup } from '../src/articles/voz-post-renderer.js';
import { normalizeArticleMediaMarkup } from '../article-media.js';
import { extractThreadSnapshot, extractLegacyPosts, reconcilePosts } from '../src/board/thread-model.js';
import { renderArchive } from '../src/board/presentation.js';

const url = 'https://voz.vn/t/example.123/';
function fixture() {
    const raw = `<article class="message message--post" data-content="post-1234" data-author="Alice">
    <div class="avatar"><img src="https://data.voz.vn/avatar/alice.jpg"></div><h5 class="userTitle">Senior Member</h5>
    <ul class="message-attribution-main"><time datetime="2026-09-06T01:02:03Z">27 minutes ago</time></ul>
    <ul class="message-attribution-opposite"><a href="https://voz.vn/p/1234">#1</a></ul>
    <div class="bbWrapper"><p>Message <img src="https://example.com/photo.jpg" width="120"></p>
    <blockquote><div class="bbCodeBlock-title">Bob said:</div>Quote</blockquote>
    <details><summary>Spoiler</summary>Hidden text</details>
    <iframe src="https://www.youtube.com/embed/abcdef" allowfullscreen></iframe>
    <video controls src="https://example.com/video.mp4"></video></div>
    <div class="reactionsBar js-reactionsList"><img class="reaction-image" src="https://data.voz.vn/like.png" alt="Like">
    <a class="reactionsBar-link" href="https://voz.vn/posts/1234/reactions">Bob and 2 others</a></div></article>`;
    const source = new VozSource();
    const html = source.parseArticleHtmlContent(raw, url, {}, {escapeHtml:escapePostText, extractBalancedElementByClass:(html, name) => load(html)(`.${name}`).first().html()});
    const live = normalizeArticleMediaMarkup(html,url);
    const posts = extractLegacyPosts(live,url);
    const record = reconcilePosts({thread_id:'voz.vn:thread:123',url},posts,true);
    return {live,record};
}

test('normal and archived VOZ posts share headers, body media, quotes, spoilers and reactions', () => {
    const {live,record} = fixture();
    const archived = renderArchive(record);
    const a=load(live), b=load(archived);
    for (const selector of ['.voz-post-header','.voz-post-body','.voz-post-likes']) {
        assert.equal(b(selector).html(),a(selector).html(),selector);
    }
    assert.equal(b('iframe').length,1);
    assert.equal(b('video').length,1);
    assert.equal(b('.voz-like-users').text(),'Bob and 2 others');
    assert.equal(b('.cache-history-button').length,0);
});

test('legacy reactions are recovered without appending duplicate backup pages or losing backups', () => {
    const {live,record} = fixture();
    delete record.posts['1234'].reaction_html;
    record.legacy_snapshots = [{content:live,url,captured_at:'2026-09-06T02:00:00Z'}, {content:live,url,captured_at:'2026-09-06T03:00:00Z'}];
    const before = JSON.stringify(record);
    const $=load(renderArchive(record));
    assert.equal($('.voz-post').length,1);
    assert.equal($('.voz-post-likes').length,1);
    assert.equal($('.cache-legacy').length,0);
    assert.doesNotMatch($.html(),/Original cached page/);
    assert.equal(JSON.stringify(record),before);
    record.posts['1234'].reaction_html='';
    assert.equal(load(renderArchive(record))('.voz-post-likes').length,0,'captured empty reactions override old reactions');
});

test('reaction updates are not author edits and legacy-only archives remain readable', () => {
    const {record,live}=fixture();
    const old=record.posts['1234'];
    reconcilePosts(record,[{...old,reaction_html:'<div class="voz-post-likes">New reaction</div>'}],true);
    assert.equal(record.posts['1234'].versions.length,1);
    assert.match(renderArchive({url,posts:{},legacy_snapshots:[{url,content:live,captured_at:'2026-09-06T03:00:00Z'}]}),/Bob and 2 others/);
});

test('shared post sanitization retains supported embeds and rejects executable markup', () => {
    const html=sanitizePostMarkup('<script>alert(1)</script><img src="x" onerror="alert(1)"><iframe src="https://www.youtube.com/embed/ok" srcdoc="bad"></iframe><iframe src="https://youtube.com.evil.test/embed"></iframe><iframe src="javascript:alert(1)"></iframe>');
    assert.doesNotMatch(html,/onerror|srcdoc|<script|evil.test|javascript:/);
    assert.equal(load(html)('iframe').length,1);
});


test('VOZ compact timezone offsets and data-timestamp supply source times in both parsers', () => {
    const source = new VozSource();
    for (const attributes of ['datetime="2026-09-07T13:40:06+0700" data-time="1:40 PM"', 'data-timestamp="1788763206" data-time="1:40 PM"', 'datetime="invalid" data-timestamp="1788763206"']) {
        const raw = `<article class="message message--post" data-content="post-43606499" data-author="Member"><ul class="message-attribution-main"><li><time ${attributes}>Today at 1:40 PM</time></li></ul><div class="message-body"><div class="bbWrapper">Original post body</div></div></article>`;
        const live = source.parseArticleHtmlContent(raw,url,{}, {escapeHtml:escapePostText,extractBalancedElementByClass:(html,name)=>load(html)(`.${name}`).first().html()});
        assert.equal(load(live)('time').attr('datetime'),'2026-09-07T06:40:06.000Z');
        assert.equal(load(live)('time').attr('data-time-kind'),'created');
        assert.equal(extractThreadSnapshot(raw,url).posts[0].source_created_at,'2026-09-07T06:40:06.000Z');
    }
});
