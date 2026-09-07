import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function createReaderApp(hash = '#category/Forum') {
    const code = readFileSync(new URL('../script.js', import.meta.url), 'utf8');
    const storage = { getItem: () => null, setItem: () => {} };
    const location = { hash, pathname: '/', search: '' };
    const historyCalls = [];
    const updateLocation = (method, state, title, url) => {
        historyCalls.push({ method, url });
        location.hash = url.slice(url.indexOf('#'));
    };
    const history = {
        state: null,
        pushState: (...args) => updateLocation('push', ...args),
        replaceState: (...args) => updateLocation('replace', ...args)
    };
    const window = {
        innerWidth: 1200,
        location,
        history,
        speechSynthesis: { cancel() {}, getVoices: () => [] },
        addEventListener() {}
    };
    const document = {
        cookie: '',
        body: { style: {} },
        getElementById: () => null,
        addEventListener() {}
    };
    const context = {
        window,
        document,
        navigator: { maxTouchPoints: 0 },
        localStorage: storage,
        sessionStorage: storage,
        URL,
        URLSearchParams,
        console,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        fetch: async () => ({ ok: false }),
        performance: { now: () => 0 },
        requestAnimationFrame: callback => callback(),
        cancelAnimationFrame() {},
        confirm: () => false,
        alert() {}
    };

    vm.createContext(context);
    vm.runInContext(code, context);
    return { app: vm.runInContext('rssApp()', context), location, historyCalls, document, context };
}

test('article permalink appends one encoded source URL to the active category', () => {
    const { app, location, historyCalls } = createReaderApp();
    const article = { link: 'https://voz.vn/t/example.1273480/unread' };
    app.selectedFilterType = 'category';
    app.selectedFilterValue = 'Forum';

    app.updateArticleRoute(article);
    app.updateArticleRoute(article);

    assert.equal(location.hash, '#category/Forum?article=https%3A%2F%2Fvoz.vn%2Ft%2Fexample.1273480%2Funread');
    assert.equal((location.hash.match(/\?article=/g) || []).length, 1);
    assert.equal(historyCalls.length, 1);
    assert.deepEqual({ ...app.getFilterFromHash() }, {
        type: 'category',
        value: 'Forum',
        articleUrl: article.link
    });
});

test('article permalinks discard trailing copied punctuation', () => {
    const malformed = 'https://tienphong.vn/story-post1870739.tpo)';
    const { app, location } = createReaderApp(`#smart/news_vietnam?article=${encodeURIComponent(malformed)}`);

    assert.equal(
        app.articleRouteUrl(malformed),
        'https://tienphong.vn/story-post1870739.tpo'
    );
    assert.equal(
        app.getFilterFromHash().articleUrl,
        'https://tienphong.vn/story-post1870739.tpo'
    );

    app.selectedFilterType = 'smart';
    app.selectedFilterValue = 'news_vietnam';
    app.updateArticleRoute(malformed, true);
    assert.equal(
        location.hash,
        '#smart/news_vietnam?article=https%3A%2F%2Ftienphong.vn%2Fstory-post1870739.tpo'
    );
});

test('VOZ state variants count as one hidden article', () => {
    const { app } = createReaderApp();
    app.hiddenStates = [
        'https://voz.vn/t/example.1273480/unread',
        'https://voz.vn/t/example.1273480/post-123456',
        'https://voz.vn/t/example.1273480/page-2'
    ];

    assert.equal(app.hiddenArticleCount(), 1);
});

test('folder links round-trip spaces, slashes, percent signs and article markers', () => {
    const { app, location } = createReaderApp();
    app.selectedFilterType = 'board';
    app.selectedFilterValue = 'Research / 100% ?article= café';
    location.hash = app.filterHash();
    assert.equal(app.getFilterFromHash().value, app.selectedFilterValue);
    assert.equal(app.getFilterFromHash().articleUrl, '');
    assert.ok(location.hash.includes('%2F'));
    assert.ok(location.hash.includes('%3Farticle%3D'));
});

test('keyword editor keeps phrases intact, supports in-place edits and removal', () => {
    const { app } = createReaderApp();
    const rule = { keywords: [] };
    const input = { value: ' Vision Pro headset ' };
    app.addCacheKeyword(rule, input);
    assert.deepEqual(Array.from(rule.keywords), ['vision pro headset']);
    assert.equal(input.value, '');
    app.editCacheKeyword(rule, 0, { value: 'Apple Vision Pro' });
    assert.deepEqual(Array.from(rule.keywords), ['apple vision pro']);
    app.addCacheKeyword(rule,{value:'APPLE VISION PRO'});
    assert.equal(rule.keywords.length,1);
    app.editCacheKeyword(rule, 0, { value: '' });
    assert.equal(rule.keywords.length, 0);
});


test('source-relative time advances without fetching a publisher and exact dates remain accessible', () => {
    const { app, document } = createReaderApp();
    const el = { dataset: { sourceTime: '2026-09-07T03:42:00Z', timeKind: 'created', timeExact: 'false' }, setAttribute() {} };
    document.querySelectorAll = () => [el];
    app.clockNow = Date.parse('2026-09-07T04:09:00Z');app.updateSourceTimes();
    assert.equal(el.textContent, '27 minutes ago');
    app.clockNow += 3600000;app.updateSourceTimes();
    assert.equal(el.textContent, '1 hour ago');
    el.dataset.timeExact = 'true';app.updateSourceTimes();
    assert.equal(el.textContent, '1 hour ago');
    el.dataset.timeKind = 'cached';app.updateSourceTimes();
    assert.equal(el.textContent, '1 hour ago');
    assert.doesNotMatch(el.title, /cached|Created/);
    app.toggleSourceTime({target:{closest:()=>el},preventDefault(){},stopPropagation(){}});
    assert.match(el.textContent, /2026/);
    assert.doesNotMatch(el.textContent, /cached|ago/);
    app.toggleSourceTime({target:{closest:()=>el},preventDefault(){},stopPropagation(){}});
    app.clockNow = new Date(2026,8,7,15,0).getTime();
    el.dataset.sourceTime = new Date(2026,8,7,10,21).toISOString();
    app.updateSourceTimes();assert.equal(el.textContent,'Today at 10:21 AM');
    app.clockNow = new Date(2026,8,8,15,0).getTime();
    app.updateSourceTimes();assert.equal(el.textContent,'Yesterday at 10:21 AM');
    app.clockNow = new Date(2026,8,10,15,0).getTime();
    app.updateSourceTimes();assert.equal(el.textContent,'Monday at 10:21 AM');
});


test('Board save sends bounded metadata without HTML or embedded image payloads', async () => {
    const {app}=createReaderApp();
    let sent;
    app.boardModalArticle={link:'https://voz.vn/t/sample.123',title:'Sample',content:'<div>'+ 'x'.repeat(200000)+'</div>',image:'data:image/png;base64,'+'x'.repeat(200000)};
    app.cacheRequest=async (url,options)=>{sent=JSON.parse(options.body);return {boardStates:[sent.article.link],userPreferences:{}}};
    app.loadCacheState=async()=>{};
    await app.assignBoardFolder('cache');
    assert.equal(sent.folder,'cache');assert.equal(sent.article.link,app.boardModalArticle.link);
    assert.ok(JSON.stringify(sent).length < 1000);
    assert.equal(sent.article.content,undefined);assert.equal(sent.article.image,undefined);
    assert.equal(app.boardModalOpen,false);
});

test('Board save explains HTML and oversized responses instead of leaking a JSON parser error', async()=>{
    const {app,context}=createReaderApp();
    context.fetch=async()=>({ok:false,status:413,text:async()=>'<!DOCTYPE html><html>Error</html>'});
    await assert.rejects(app.cacheRequest('/api/board-cache/folder'),/too large/);
    context.fetch=async()=>({ok:false,status:403,text:async()=>'<!DOCTYPE html><html>Blocked</html>'});
    await assert.rejects(app.cacheRequest('/api/board-cache/folder'),/HTTP 403/);
});


test('source times are formatted before HTML is inserted, including reopening old cached markup',()=>{
    const {app,context}=createReaderApp();
    context.DOMParser=new JSDOM('').window.DOMParser;
    app.clockNow=new Date(2026,8,7,18,0).getTime();
    const value=new Date(2026,8,7,15,32).toISOString();
    const raw=`<time data-source-time="${value}" datetime="${value}" data-time-kind="created">${value}</time>`;
    const parsed=new context.DOMParser().parseFromString(app.formatSourceTimeMarkup(raw),'text/html');
    assert.equal(parsed.querySelector('time').textContent,'Today at 3:32 PM');
    assert.equal(parsed.querySelector('time').getAttribute('datetime'),value);
    assert.equal(app.formatSourceTimeMarkup('<p>No timestamp</p>'),'<p>No timestamp</p>');
});

test('cache pause changes immediately and rolls back a failed save',async()=>{
    const {app}=createReaderApp();
    const member={thread_id:'voz.vn:thread:123',url:'https://voz.vn/t/example.123',in_cache:true,active_caching:true};
    app.cacheMembers[member.thread_id]=member;
    let reject;
    app.cacheRequest=()=>new Promise((_,r)=>{reject=r});
    const pending=app.setCacheActive(member.url);
    assert.equal(member.active_caching,false);
    reject(Error('Save failed'));await pending;
    assert.equal(member.active_caching,true);assert.equal(app.cacheNotice,'Save failed');
});

test('resume scrolls to the saved permanent post after its displayed number changes',()=>{
    const {app,context}=createReaderApp();
    const dom=new JSDOM('<main><div class="voz-post" id="voz-post-79" data-post-index="79" data-absolute-post-id="30"></div><div class="voz-post" id="voz-post-81" data-post-index="81" data-absolute-post-id="99"></div></main>');
    context.document=dom.window.document;
    const target=context.document.getElementById('voz-post-79');
    Object.defineProperty(target,'offsetParent',{value:target.parentElement});
    dom.window.HTMLElement.prototype.scrollIntoView=function(){};
    app.overlayArticle={link:'https://voz.vn/t/test.1276630'};
    app.userPreferences.voz_last_read_post_1276630=JSON.stringify({index:'81',absId:'30'});
    app.articleOverlayOpen=true;app.vozInitialThreadLoad=true;app.overlayRequestId='resume-test';
    app.checkVozThreadPosition();
    assert.equal(target.previousElementSibling.id,'voz-inline-notice');
    assert.match(target.previousElementSibling.textContent,/#79/);
    assert.equal(context.document.getElementById('voz-post-81').previousElementSibling,target);
});

test('Board folder click shows pending state, ignores duplicate clicks and closes without a cache refresh',async()=>{
    const {app}=createReaderApp();app.boardModalArticle={link:'https://voz.vn/t/example.123',title:'Example'};app.boardModalOpen=true;
    let finish,calls=0;
    app.cacheRequest=()=>{calls++;return new Promise(r=>finish=r)};
    app.loadCacheState=()=>{throw Error('Save must not wait for another request')};
    const save=app.assignBoardFolder('cache');
    assert.equal(app.boardSavePending,true);assert.equal(app.boardSavingFolder,'cache');assert.equal(app.cacheNotice,'Saving…');
    await app.assignBoardFolder('cache');assert.equal(calls,1);
    const member={thread_id:'voz.vn:thread:123',in_cache:true,active_caching:true};
    finish({boardStates:[app.boardModalArticle.link],userPreferences:{},cacheMember:member});await save;
    assert.equal(app.boardModalOpen,false);assert.equal(app.boardSavePending,false);assert.equal(app.cacheMembers[member.thread_id],member);
});

test('failed Board save stays open with an error and permits a retry',async()=>{
    const {app}=createReaderApp();app.boardModalArticle={link:'https://voz.vn/t/example.123'};app.boardModalOpen=true;
    app.cacheRequest=async()=>{throw Error('Request failed')};await app.assignBoardFolder('cache');
    assert.equal(app.boardModalOpen,true);assert.equal(app.boardSavePending,false);assert.equal(app.cacheNotice,'Request failed');
});
