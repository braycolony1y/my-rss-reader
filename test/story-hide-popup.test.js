import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const story = {
    link: 'https://example.test/s1', clusterId: 'c1', title: 'VinFast khởi công nhà máy xe điện tại Hà Tĩnh', content: 'Dự án VinFast.',
    relatedArticles: [{ link: 'https://example.test/s2', title: 'Nhà máy VinFast Hà Tĩnh' }],
};
const other = { link: 'https://example.test/o1', title: 'Giá vàng tăng', relatedArticles: [] };

async function setup({ keywords = ['giá vàng'], suggestions = [{ keyword: 'vinfast' }, { keyword: 'hà tĩnh' }], failSuggest = false } = {}) {
    const calls = [];
    let stored = [...keywords];
    const fetch = async (url, options = {}) => {
        const path = String(url);
        calls.push({ path, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
        if (path.startsWith('/api/content-filters/suggest')) {
            if (failSuggest) return new Response('<html>Service unavailable</html>', { status: 503 });
            return { ok: true, json: async () => ({ title: story.title, suggestions }) };
        }
        if (path === '/api/content-filter-settings') {
            if (options.method === 'POST') stored = JSON.parse(options.body).keywords;
            return { ok: true, json: async () => ({ keywords: stored }) };
        }
        if (path === '/api/toggle') return { ok: true };
        throw new Error('unexpected ' + path);
    };
    const context = vm.createContext({ console, crypto, AbortController, setTimeout, clearTimeout, fetch, URLSearchParams,
        window: { innerWidth: 1440, innerHeight: 900 }, document: { querySelector: () => null, activeElement: null } });
    vm.runInContext(await readFile('public/js/feeds/reading-state.js', 'utf8'), context);
    vm.runInContext(await readFile('public/js/smart/feedback-picker.js', 'utf8') + '\nthis.factory = ReaderSmartFeedback;', context);
    const ui = context.factory.create();
    const states = vm.runInContext('ReaderFeedsReadingState.create()', context);
    const toggles = [];
    Object.assign(ui, {
        ...states,
        selectedFilterType: 'smart', articles: [story, other], hiddenStates: [], blockedKeywords: [], blockedKeywordsDraft: [], contentFilterSettingsOpen: false,
        unreadCounts: { total: 2, feeds: {}, categories: {} },
        $nextTick: () => {}, stripHtml: value => value,
        normalizeKeywordPhrase: value => String(value || '').normalize('NFKC').toLowerCase().trim(),
        normalizeKeywordList(values) { return [...new Set(values.map(value => this.normalizeKeywordPhrase(value)).filter(Boolean))]; },
        async toggleState(list, article) {
            toggles.push([list, article]);
            return states.toggleState.call(this, list, article);
        },
        fetchData: async () => ({}), openContentFilterSettings() { this.opened = true; },
    });
    const feedbackWrites = [];
    const proxies = new WeakMap();
    // Alpine wraps assigned objects on read. Mutations to a retained raw object bypass its effects.
    const reactiveUi = new Proxy(ui, {
        get(target, key, receiver) {
            const value = Reflect.get(target, key, receiver);
            if ((key !== 'feedbackSession' && key !== 'feedbackToast') || !value) return value;
            if (!proxies.has(value)) {
                proxies.set(value, new Proxy(value, {
                    set(state, field, next) {
                        feedbackWrites.push(field);
                        return Reflect.set(state, field, next);
                    },
                }));
            }
            return proxies.get(value);
        },
    });
    return { ui: reactiveUi, feedbackWrites, calls, toggles, stored: () => stored, context };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test('opening loads suggestions as unselected chips and the preview line stays empty until something is chosen', async () => {
    const { ui, calls, feedbackWrites } = await setup();
    ui.openSmartFeedback(story, {});
    assert.equal(ui.feedbackSession.loading, true);
    await settle();
    assert.equal(ui.feedbackSession.loading, false);
    assert.ok(feedbackWrites.includes('loading'), 'loading must update through the reactive session');
    assert.ok(feedbackWrites.includes('chips'), 'chips must update through the reactive session');
    assert.deepEqual(JSON.parse(JSON.stringify(ui.feedbackSession.chips)), [
        { keyword: 'vinfast', typed: false, selected: false }, { keyword: 'hà tĩnh', typed: false, selected: false }]);
    assert.match(calls[0].path, /^\/api\/content-filters\/suggest\?link=https%3A%2F%2Fexample\.test%2Fs1&clusterId=c1$/);
    assert.equal(ui.feedbackPreviewText, '');
    assert.equal(ui.feedbackConfirmLabel, 'Hide this story');
    ui.toggleFeedbackChip(ui.feedbackSession.chips[0]);
    assert.equal(ui.feedbackPreviewText, '1 story in view would be hidden');
    assert.equal(ui.feedbackConfirmLabel, 'Hide matching stories');
});

test('typed text becomes chips on comma, Enter or the Add button; duplicates re-select instead of repeating', async () => {
    const { ui } = await setup();
    ui.openSmartFeedback(story, {});
    await settle();
    ui.feedbackSession.input = 'Tesla Model Y';
    let prevented = 0;
    ui.onFeedbackInputKeydown({ key: ',', preventDefault: () => prevented++ });
    assert.equal(prevented, 1);
    ui.feedbackSession.input = 'vinfast, xe điện ,';
    ui.addFeedbackInput();
    const chips = JSON.parse(JSON.stringify(ui.feedbackSession.chips));
    assert.deepEqual(chips.map(c => [c.keyword, c.typed, c.selected]), [
        ['vinfast', false, true], ['hà tĩnh', false, false], ['tesla model y', true, true], ['xe điện', true, true]]);
    ui.onFeedbackInputKeydown({ key: 'a', preventDefault: () => assert.fail('only Enter and comma add') });
    ui.removeFeedbackChip(ui.feedbackSession.chips[2]);
    assert.equal(ui.feedbackSession.chips.length, 3);
});

test('confirm adds only new keywords to Content filters, hides cards at once and Undo removes just those entries', async () => {
    const { ui, calls, stored } = await setup({ keywords: ['giá vàng', 'vinfast'] });
    ui.openSmartFeedback(story, {});
    await settle();
    ui.toggleFeedbackChip(ui.feedbackSession.chips[0]);
    ui.toggleFeedbackChip(ui.feedbackSession.chips[1]);
    ui.feedbackSession.input = 'Nhà Máy';
    await ui.confirmSmartFeedback();
    assert.equal(ui.feedbackSession, null);
    assert.deepEqual(stored(), ['giá vàng', 'vinfast', 'hà tĩnh', 'nhà máy']);
    const post = calls.find(call => call.method === 'POST');
    assert.deepEqual(post.body.keywords, ['giá vàng', 'vinfast', 'hà tĩnh', 'nhà máy']);
    assert.deepEqual(JSON.parse(JSON.stringify(ui.feedbackToast.added)), ['hà tĩnh', 'nhà máy']);
    assert.match(ui.feedbackToast.message, /Hiding stories containing/);
    assert.deepEqual(JSON.parse(JSON.stringify(ui.blockedKeywords)), ['giá vàng', 'vinfast', 'hà tĩnh', 'nhà máy']);
    // Another edit made meanwhile survives Undo.
    await ui.feedbackKeywordList('POST', [...stored(), 'bitcoin']);
    await ui.undoSmartFeedback();
    assert.deepEqual(stored(), ['giá vàng', 'vinfast', 'bitcoin']);
    assert.equal(ui.feedbackToast, null);
});

test('cards matching the new keywords are hidden immediately, only in Stories', async () => {
    const { ui } = await setup();
    ui.fetchData = () => new Promise(() => {}); // the server list has not arrived yet
    ui.openSmartFeedback(story, {});
    await settle();
    ui.toggleFeedbackChip(ui.feedbackSession.chips[0]);
    ui.confirmSmartFeedback();
    await settle(); await settle();
    assert.equal(ui.isSmartFeedbackHidden(story), true);
    assert.equal(ui.isSmartFeedbackHidden(other), false);
    ui.selectedFilterType = 'today';
    assert.equal(ui.isSmartFeedbackHidden(story), false);
    ui.dismissFeedbackToast();
});

test('with no keyword chosen the default action hides just this story, and Undo restores it', async () => {
    const { ui, calls, toggles } = await setup();
    const article = { ...story, originalLink: 'https://news.google.com/read/stable' };
    ui.openSmartFeedback(article, {});
    await settle();
    const suggestionUrl = new URL(calls[0].path, 'https://reader.test');
    assert.equal(suggestionUrl.searchParams.get('originalLink'), article.originalLink);
    await ui.confirmSmartFeedback();
    assert.deepEqual(toggles.map(([list, article]) => [list, article.link]), [['hiddenStates', story.link]]);
    assert.ok(!calls.some(call => call.path === '/api/content-filter-settings'));
    assert.equal(ui.isSmartFeedbackHidden(story), true);
    assert.equal(ui.hiddenStateAliases[article.originalLink], article.link);
    assert.equal(ui.hiddenArticleCount(), 1);
    await ui.undoSmartFeedback();
    assert.deepEqual(toggles.map(([list, article]) => [list, article.link]), [['hiddenStates', story.link], ['hiddenStates', story.link]]);
    assert.equal(ui.isSmartFeedbackHidden(story), false);
    assert.equal(Object.hasOwn(ui.hiddenStateAliases, article.originalLink), false);
    assert.equal(ui.hiddenArticleCount(), 0);
});

test('hiding and undoing a repaired story honor its wrapper alias', async () => {
    const { ui, toggles } = await setup();
    const article = { ...story, originalLink: 'https://news.google.com/read/stable' };
    ui.hiddenStates = [article.originalLink];
    ui.openSmartFeedback(article, {});
    await settle();
    await ui.confirmSmartFeedback();
    assert.equal(toggles.length, 0, 'the wrapper already hides this story');
    await ui.undoSmartFeedback();
    assert.equal(toggles.length, 1);
    assert.equal(toggles[0][1].originalLink, article.originalLink);
    assert.equal(ui.hiddenStates.length, 0);
});

test('a non-JSON HTTP error clears reactive loading and still allows typing', async () => {
    const { ui, calls, feedbackWrites } = await setup({ failSuggest: true });
    ui.openSmartFeedback(story, {});
    await settle();
    assert.equal(ui.feedbackSession.failed, true);
    assert.equal(ui.feedbackSession.loading, false);
    assert.ok(feedbackWrites.includes('failed'));
    assert.ok(feedbackWrites.includes('loading'));
    assert.match(ui.feedbackMessage, /type your own/);
    ui.feedbackSession.input = 'bitcoin';
    assert.equal(ui.addFeedbackInput(), 1);
    ui.cancelSmartFeedback();
    assert.equal(ui.feedbackSession, null);
    ui.openSmartFeedback(story, {});
    ui.feedbackContextChanged();
    assert.equal(ui.feedbackSession, null);
    assert.ok(calls.every(call => call.method === 'GET'));
});

test('a reactive feedback toast expires', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { ui, context } = await setup();
    ui.showFeedbackToast({ kind: 'story', message: 'Story hidden.' });
    assert.equal(ui.feedbackToast.message, 'Story hidden.');
    t.mock.timers.tick(context.factory.toastMs);
    assert.equal(ui.feedbackToast, null);
});

test('focus stays inside the dialog on Tab', async () => {
    const { ui, context } = await setup();
    const nodes = [{ focus() { context.document.activeElement = this; } }, { focus() { context.document.activeElement = this; } }];
    for (const node of nodes) node.getClientRects = () => [1];
    const panel = { querySelectorAll: () => nodes };
    context.document.activeElement = nodes[1];
    let prevented = false;
    ui.trapFeedbackFocus({ key: 'Tab', shiftKey: false, currentTarget: panel, preventDefault: () => { prevented = true; } });
    assert.ok(prevented);
    assert.equal(context.document.activeElement, nodes[0]);
});
