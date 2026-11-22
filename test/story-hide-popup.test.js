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
            if (failSuggest) return { ok: false, json: async () => ({ error: 'nope' }) };
            return { ok: true, json: async () => ({ title: story.title, suggestions }) };
        }
        if (path === '/api/content-filter-settings') {
            if (options.method === 'POST') stored = JSON.parse(options.body).keywords;
            return { ok: true, json: async () => ({ keywords: stored }) };
        }
        throw new Error('unexpected ' + path);
    };
    const context = vm.createContext({ console, crypto, AbortController, setTimeout, clearTimeout, fetch, URLSearchParams,
        window: { innerWidth: 1440, innerHeight: 900 }, document: { querySelector: () => null, activeElement: null } });
    vm.runInContext(await readFile('public/js/feeds/reading-state.js', 'utf8'), context);
    vm.runInContext(await readFile('public/js/smart/feedback-picker.js', 'utf8') + '\nthis.factory = ReaderSmartFeedback;', context);
    const ui = context.factory.create();
    const toggles = [];
    Object.assign(ui, {
        ...vm.runInContext('ReaderFeedsReadingState.create()', context),
        selectedFilterType: 'smart', articles: [story, other], hiddenStates: [], blockedKeywords: [], blockedKeywordsDraft: [], contentFilterSettingsOpen: false,
        $nextTick: () => {}, stripHtml: value => value,
        normalizeKeywordPhrase: value => String(value || '').normalize('NFKC').toLowerCase().trim(),
        normalizeKeywordList(values) { return [...new Set(values.map(value => this.normalizeKeywordPhrase(value)).filter(Boolean))]; },
        async toggleState(list, article) {
            toggles.push([list, article]);
            if (this.hasArticleState(list, article)) this[list] = this[list].filter(link => link !== article.link && link !== article.originalLink);
            else this[list].push(article.link);
        },
        fetchData: async () => ({}), openContentFilterSettings() { this.opened = true; },
    });
    return { ui, calls, toggles, stored: () => stored, context };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test('opening loads suggestions as unselected chips and the preview line stays empty until something is chosen', async () => {
    const { ui, calls } = await setup();
    ui.openSmartFeedback(story, {});
    assert.equal(ui.feedbackSession.loading, true);
    await settle();
    assert.equal(ui.feedbackSession.loading, false);
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
});

test('with no keyword chosen the default action hides just this story, and Undo restores it', async () => {
    const { ui, calls, toggles } = await setup();
    ui.openSmartFeedback(story, {});
    await settle();
    await ui.confirmSmartFeedback();
    assert.deepEqual(toggles.map(([list, article]) => [list, article.link]), [['hiddenStates', story.link]]);
    assert.ok(!calls.some(call => call.path === '/api/content-filter-settings'));
    assert.equal(ui.isSmartFeedbackHidden(story), true);
    await ui.undoSmartFeedback();
    assert.deepEqual(toggles.map(([list, article]) => [list, article.link]), [['hiddenStates', story.link], ['hiddenStates', story.link]]);
    assert.equal(ui.isSmartFeedbackHidden(story), false);
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
    assert.deepEqual(ui.hiddenStates, []);
});

test('suggestion failure still allows typing; cancel and context changes close without writing', async () => {
    const { ui, calls } = await setup({ failSuggest: true });
    ui.openSmartFeedback(story, {});
    await settle();
    assert.equal(ui.feedbackSession.failed, true);
    assert.match(ui.feedbackMessage, /type your own/);
    ui.feedbackSession.input = 'bitcoin';
    ui.addFeedbackInput();
    ui.cancelSmartFeedback();
    assert.equal(ui.feedbackSession, null);
    ui.openSmartFeedback(story, {});
    ui.feedbackContextChanged();
    assert.equal(ui.feedbackSession, null);
    assert.ok(calls.every(call => call.method === 'GET'));
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
