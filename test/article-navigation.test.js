import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { afterEach } from 'node:test';

const readerTimers = new Set();
afterEach(() => {
    for (const timer of readerTimers) clearTimeout(timer);
    readerTimers.clear();
});
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

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
        location,
        crypto: webcrypto,
        document,
        navigator: { maxTouchPoints: 0 },
        localStorage: storage,
        sessionStorage: storage,
        URL,
        URLSearchParams,
        console,
        setTimeout(callback, delay, ...args) {
            const timer = setTimeout(callback, delay, ...args);
            readerTimers.add(timer);
            return timer;
        },
        clearTimeout,
        setInterval: () => 0,
        clearInterval,
        fetch: async () => ({ ok: false }),
        performance: { now: () => 0 },
        requestAnimationFrame: callback => callback(),
        cancelAnimationFrame() {},
        confirm: () => false,
        alert() {}
    };

    vm.createContext(context);
    // TEST_MUTATION_OBSERVER_STUB_V1
    // Browser API shim for the VM test environment only.
    // Production browsers provide MutationObserver natively.
    if (typeof context.MutationObserver === 'undefined') {
        context.MutationObserver = class MutationObserver {
            constructor(callback) {
                this.callback = callback;
            }
            observe() {}
            disconnect() {}
            takeRecords() { return []; }
        };
    }

    vm.runInContext(code, context);
    return { app: vm.runInContext('rssApp()', context), location, historyCalls, document, context };
}

test('Reddit opens directly in a new tab on desktop, mobile and related-article navigation', async () => {
    for (const mobile of [false, true]) {
        const { app, context, historyCalls } = createReaderApp();
        const opened = [];
        const article = { link: 'https://old.reddit.com/r/test/comments/abc/story/' };
        context.window.open = (...args) => opened.push(args);
        context.fetch = () => assert.fail('Reddit must not fetch reader content');
        app.isMobile = mobile;
        app.markAsReadExplicit = link => assert.equal(link, article.link);
        app.handleCardClick(article, { preventDefault() {} });
        await app.openRelatedArticle(article);
        assert.equal(opened.length, 2);
        assert.deepEqual(opened[0], [article.link, '_blank', 'noopener,noreferrer']);
        assert.equal(historyCalls.length, 0);
        assert.equal(app.articleOverlayOpen, false);
        app.handleCardHover(article);
        app.prefetchArticlesList([article]);
        assert.equal(app.prefetchQueue.length, 0);
    }
});

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
    assert.equal(app.boardSavePending,true);assert.equal(app.boardSavingFolder,'cache');assert.equal(app.cacheNotice,'');
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

test('Board removal and folder selection recognize unread, post, and renamed thread URLs',()=>{
    const {app}=createReaderApp();app.boardStates=['https://voz.vn/t/original.1276725/unread'];
    app.userPreferences.boardFolderMappings={[app.boardStates[0]]:'cache'};
    const article={link:'https://voz.vn/t/renamed.1276725/post-43600000'};
    assert.equal(app.isOnBoard(article),true);assert.equal(app.boardFolderFor(article),'cache');
    app.boardStates=[];assert.equal(app.isOnBoard(article),false);
    assert.equal(app.isOnBoard(null),false);
});

test('Board uses the header selector without a second folder toolbar',()=>{
    const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
    assert.doesNotMatch(html,/class="cache-glass board-tools"|aria-label="Board folders"/);
    assert.match(html,/x-show="isOnBoard\(boardModalArticle\)"/);
    assert.match(html,/class="cache-settings-button"/);
});

test('Board source links jump to VOZ unread without changing reader pagination', () => {
    const { app } = createReaderApp('#board');
    app.selectedFilterType = 'board';
    const base = 'https://voz.vn/t/example.1273480';
    for (const suffix of ['', '/', '/unread', '/page-3#post-123', '/post-123']) {
        const article = { link: base, resolvedLink: base + suffix };
        assert.equal(app.articleSourceUrl(article), base + '/unread');
        assert.equal(app.articleReaderUrl(article), base + suffix);
    }
    assert.equal(app.articleSourceUrl({ link: 'https://example.com/news' }), 'https://example.com/news');
    app.selectedFilterType = 'category';
    assert.equal(app.articleSourceUrl({ link: base + '/page-3' }), base + '/page-3');
    app.boardStates = [base];
    assert.equal(app.articleSourceUrl({ link: base + '/page-3' }), base + '/unread');
});

test('removing a Board thread updates only that thread through the folder endpoint', async () => {
    const { app } = createReaderApp('#board');
    const url = 'https://voz.vn/t/example.123';
    app.boardStates = [url];
    app.userPreferences = { boardFolderMappings: { [url]: 'cache' } };
    const calls = [];
    app.cacheRequest = async (endpoint, options) => {
        calls.push({ endpoint, body: JSON.parse(options.body) });
        return { boardStates: [], userPreferences: { boardFolderMappings: {} }, cacheMember: { thread_id: 'voz.vn:thread:123', in_cache: false } };
    };
    app.saveState = () => {};
    await app.toggleState('boardStates', url + '/unread');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].endpoint, '/api/board-cache/folder');
    assert.equal(calls[0].body.folder, null);
    assert.equal(app.boardStates.length, 0);
    assert.equal(app.cacheMembers['voz.vn:thread:123'].in_cache, false);
});

test('successful Board removal uses one compact request and preserves the loaded list state', async () => {
    const { app, document } = createReaderApp('#board/cache');
    const article = { link: 'https://voz.vn/t/example.123/unread', title: 'Example' };
    const before = { link: 'https://example.com/before' }, after = { link: 'https://example.com/after' };
    app.articles = [before, article, after]; app.boardStates = [article.link];
    app.selectedFilterType = 'board'; app.selectedFilterValue = 'cache';
    app.currentPage = 4; app.hasMore = true; app.sortBy = 'oldest';
    app.boardModalArticle = article; app.boardModalOpen = true;
    const container = { scrollTop: 812 }; document.getElementById = () => container;
    app.$nextTick = callback => callback();
    app.fetchData = () => { throw Error('Removal must not refetch'); };
    let finish, calls = 0;
    app.cacheRequest = (url, options) => {
        calls++;
        assert.equal(JSON.parse(options.body).compact, true);
        assert.equal(options.keepalive, true);
        return new Promise(resolve => { finish = resolve; });
    };
    const removal = app.removeArticleFromBoard();
    assert.equal(app.boardSavePending, true); assert.equal(app.boardSavingFolder, null);
    assert.equal(app.cacheNotice, '');
// Optimistic Board removal hides the row before persistence completes.
assert.equal(app.articles.length, 2);
    await app.removeArticleFromBoard(); assert.equal(calls, 1);
    finish({ thread_id: 'voz.vn:thread:123', url: article.link, folder: null, cacheMember: { thread_id: 'voz.vn:thread:123', in_cache: false } });
    await removal;
    assert.equal(app.articles.length, 2); assert.equal(app.articles[0], before); assert.equal(app.articles[1], after);
    assert.equal(container.scrollTop, 812); assert.equal(app.currentPage, 4); assert.equal(app.hasMore, true);
    assert.equal(app.sortBy, 'oldest'); assert.equal(app.selectedFilterValue, 'cache');
    assert.equal(app.boardStates.length, 0); assert.equal(app.boardModalOpen, false);
});

test('folder moves update only local membership and remove a row only from a mismatched Board folder', async () => {
    const { app } = createReaderApp(); const article = { link: 'https://example.org/a' };
    app.boardStates = [article.link]; app.articles = [article];
    app.userPreferences = { theme: 'light', boardFolderMappings: { [article.link]: 'old', 'https://example.org/b': 'other' } };
    app.selectedFilterType = 'board'; app.selectedFilterValue = '';
    app.applyBoardFolderResult({ thread_id: article.link, url: article.link }, article, 'new');
    assert.equal(app.articles[0], article); assert.equal(app.userPreferences.theme, 'light');
    assert.equal(app.userPreferences.boardFolderMappings['https://example.org/b'], 'other');
    app.selectedFilterValue = 'new';
    app.applyBoardFolderResult({ thread_id: article.link, url: article.link }, article, 'other');
    assert.equal(app.articles.length, 0);
});

test('an older Cache status response cannot refetch the list after a Board mutation', async () => {
    const { app } = createReaderApp(); app.isLoggedIn = true; app.selectedFilterType = 'board';
    let finish; app.cacheRequest = () => new Promise(resolve => { finish = resolve; });
    app.fetchData = () => { throw Error('Stale poll must not refresh the list'); };
    const poll = app.loadCacheState(); app.boardMutationVersion++;
    finish({ members: { other: { in_cache: true } }, rules: [] }); await poll;
    assert.equal(Object.keys(app.cacheMembers).length, 0);
});

test('removing an earlier row preserves surrounding card DOM keys, including duplicate links', () => {
    const { app } = createReaderApp();
    const a = { link: 'https://example.org/a' }, b = { link: 'https://example.org/b' }, duplicate = { ...b };
    const keys = [a, b, duplicate].map((article, index) => app.articleRowKey(article, index));
    assert.equal(app.articleRowKey(b, 0), keys[1]);
    assert.equal(app.articleRowKey(duplicate, 1), keys[2]);
    assert.notEqual(keys[1], keys[2]);
});

test('visible cache status uses last successful sync, including while a later sync is delayed', () => {
    const { app } = createReaderApp(); const article = { link: 'https://voz.vn/t/example.123' };
    app.formatVietnamDateTime = value => value;
    app.cacheMembers = { 'voz.vn:thread:123': { in_cache: true, sync_status: 'incomplete', last_successful_sync_at: '2026-09-08T13:09:04Z' } };
    assert.equal(app.cacheLastSuccessText(article), 'Last cached successfully: 2026-09-08T13:09:04Z');
    app.cacheMembers['voz.vn:thread:123'].last_successful_sync_at = null;
    assert.equal(app.cacheLastSuccessText(article), 'Waiting for first successful cache');
});

test('VOZ resume opens the saved page directly without a blocking post redirect check', async () => {
    const { app, context } = createReaderApp();
    const requested = [];

    context.fetch = async value => {
        requested.push(new URL(value, 'http://localhost'));
        return {
            ok: true,
            json: async () => ({
                url: 'https://voz.vn/t/example.123456/page-4',
                content: 'Saved page'
            })
        };
    };

    for (const method of [
        'releaseArticleReaderSession',
        'hideTooltip',
        'stopArticleSpeech',
        'markAsReadExplicit',
        'setArticleCopyState',
        'prefetchNextAfter',
        'applyOverlayArticleData'
    ]) {
        app[method] = () => {};
    }

    app.cacheMember = () => false;

    app.userPreferences = {
        voz_last_read_post_123456: JSON.stringify({
            index: '82',
            absId: '999999',
            page: 4
        })
    };

    await app.openArticleOverlay(
        { link: 'https://voz.vn/t/example.123456/unread' },
        { updateHistory: false }
    );

    const pageRequests = requested.filter(
        url => url.pathname === '/api/article-content'
    );

    assert.equal(pageRequests.length, 1);
    assert.equal(
        pageRequests[0].searchParams.get('url'),
        'https://voz.vn/t/example.123456/page-4'
    );
    assert.equal(
        pageRequests[0].searchParams.get('resumePage'),
        '4'
    );
    assert.equal(
        pageRequests[0].searchParams.get('threadPage'),
        '1'
    );
});

test('clicking a page already being prefetched shares the request and caches the result', async () => {
    const { app, context } = createReaderApp();
    let finish, calls = 0;
    context.fetch = async value => {
        assert.equal(new URL(value, 'http://localhost').searchParams.get('feedUrl'), 'https://voz.vn/f/kinh-te.17/index.rss');
        calls++; return new Promise(resolve => { finish = resolve; });
    };
    const url = 'https://voz.vn/t/example.123456/page-6706';
    const prefetch = app.fetchThreadPage(url, 'https://voz.vn/f/kinh-te.17/index.rss', true);
    const click = app.fetchThreadPage(url);
    assert.equal(prefetch, click);
    assert.equal(calls, 1);
    finish({ ok: true, json: async () => ({ url, content: 'Page 6706' }) });
    assert.equal((await click).content, 'Page 6706');
    assert.equal((await app.fetchThreadPage(url)).content, 'Page 6706');
    assert.equal(calls, 1);
});

test('failed thread prefetch can be retried and does not poison the cache', async () => {
    const { app, context } = createReaderApp();
    let calls = 0;
    context.fetch = async () => ({ ok: ++calls > 1, json: async () => calls > 1 ? { content: 'Ready' } : { error: 'Temporary failure' } });
    await assert.rejects(app.fetchThreadPage('https://voz.vn/t/example.123456/page-2'), /Temporary failure/);
    assert.equal((await app.fetchThreadPage('https://voz.vn/t/example.123456/page-2')).content, 'Ready');
    assert.equal(calls, 2);
});

test('explicit thread page links take precedence over the saved reading position', async () => {
    const { app, context } = createReaderApp();
    const requests = [];
    context.fetch = async value => { requests.push(new URL(value, 'http://localhost')); return { ok: true, json: async () => ({ content: 'Requested page' }) }; };
    for (const method of ['releaseArticleReaderSession', 'hideTooltip', 'stopArticleSpeech', 'markAsReadExplicit', 'setArticleCopyState', 'prefetchNextAfter', 'applyOverlayArticleData']) app[method] = () => {};
    app.cacheMember = () => false;
    app.userPreferences = { voz_last_read_post_123456: JSON.stringify({ index: '82', absId: '999999', page: 4 }) };
    const url = 'https://voz.vn/t/example.123456/page-6786';
    await app.openArticleOverlay({ link: url }, { updateHistory: false });
    assert.equal(requests.find(r => r.pathname === '/api/article-content').searchParams.get('url'), url);
    assert.equal(app.vozInitialThreadLoad, false);
});

test('thread read-ahead fetches just the next two pages independently of the article queue', async () => {
    const { app, context } = createReaderApp();
    const urls = [];
    app.articleOverlayOpen = true;
    app.overlayRequestId = 'current';
    app.isProcessingPrefetch = true;
    app.prefetchQueue = [{ link: 'https://unrelated.example/article' }];
    context.fetch = async value => {
        const url = new URL(value, 'http://localhost').searchParams.get('url');
        urls.push(url);
        const page = Number(url.match(/page-(\d+)/)[1]);
        return { ok: true, json: async () => ({ url, content: 'Page ' + page, pagination: { nextUrl: url.replace(/page-\d+/, 'page-' + (page + 1)) } }) };
    };
    await app.prefetchThreadPages({ nextUrl: 'https://voz.vn/t/example.123456/page-6706' });
    assert.deepEqual(urls, ['https://voz.vn/t/example.123456/page-6706', 'https://voz.vn/t/example.123456/page-6707']);
    assert.equal(app.prefetchQueue.length, 1);
});

test('resume opens the saved page directly and reuses its cached page', async () => {
    for (const cached of [false, true]) {
        const { app, context } = createReaderApp();
        const requests = [];
        const pageUrl = 'https://voz.vn/t/example.123456/page-4000';
        const data = { url: pageUrl, content: '<div class="voz-post" data-absolute-post-id="999999">Saved reply</div>' };
        context.fetch = async value => { requests.push(value); return { ok: true, json: async () => data }; };
        for (const method of ['releaseArticleReaderSession', 'hideTooltip', 'stopArticleSpeech', 'markAsReadExplicit', 'setArticleCopyState', 'prefetchNextAfter']) app[method] = () => {};
        let applied;
        app.applyOverlayArticleData = value => { applied = value; };
        app.cacheMember = () => false;
        app.userPreferences = { voz_last_read_post_123456: JSON.stringify({ index: '79982', absId: '999999', page: 4000 }) };
        if (cached) app.articleContentCache = new Map([[pageUrl, data]]);
        await app.openArticleOverlay({ link: 'https://voz.vn/t/example.123456/unread' }, { updateHistory: false });
        assert.equal(applied.content, data.content);

        // Only reader-content requests matter here. openArticleOverlay()
        // may also persist recently-read state through a separate fetch.
        const articleRequests = requests.filter(value =>
            new URL(value, 'http://localhost').pathname === '/api/article-content'
        );

        assert.equal(articleRequests.length, cached ? 0 : 1);

        if (!cached) {
            assert.equal(
                new URL(articleRequests[0], 'http://localhost').searchParams.get('url'),
                pageUrl
            );
        }

        assert.equal(app.vozInitialThreadLoad, true);
    }
});
