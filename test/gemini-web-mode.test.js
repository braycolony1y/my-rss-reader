import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { resolveGeminiWebMode, readGeminiWebModeState, selectGeminiWebMode } from '../src/ai/gemini-web-mode.js';

const ids = [
    'bard-mode-option-8c46e95b1a07cecc',
    'bard-mode-option-56fdd199312815e2',
    'bard-mode-option-e6fa609c3fa255c0',
    'bard-mode-option-95a4c0abcba24364'
];

function fixture(layout = 'narrow') {
    const submenu = ['Low Quick and efficient', 'Medium Balanced depth', 'High Extra thorough']
        .map((name, i) => '<gem-menu-item role="menuitem" class="' +
            (i === 0 ? 'selected' : '') + '"><span class="label">' +
            name.split(' ')[0] + '</span><span>' +
            name.split(' ').slice(1).join(' ') + '</span></gem-menu-item>').join('');
    const narrow = layout === 'narrow';
    const dom = new JSDOM('<div data-test-id="gem-mode-menu">' +
        ids.map((id, i) => '<gem-menu-item role="menuitem" data-test-id="' +
            id + '" class="' + (i === 1 ? 'selected' : '') + '">' +
            ['3.5 Flash-Lite', '3.8 Flash', '3.1 Pro', '4 Argon'][i] +
            '</gem-menu-item>').join('') +
        '<gem-menu-item role="menuitem" value="thinking_level" aria-haspopup="' +
            (!narrow) + '" aria-expanded="false">' +
            '<span class="label">Thinking level</span>' +
            (narrow ? '<div class="expand-content" hidden>' + submenu + '</div>' : '') +
            '</gem-menu-item></div>' +
            (narrow ? '' : '<div class="cdk-overlay-pane" hidden><gem-menu role="menu">' +
                submenu + '</gem-menu></div>'), { runScripts: 'outside-only' });
    const { window } = dom;
    window.HTMLElement.prototype.getBoundingClientRect = () =>
        ({ width: 250, height: 350 });
    const doc = window.document;
    const trigger = doc.querySelector('[value="thinking_level"]');
    const expanded = narrow ?
        trigger.querySelector('.expand-content') :
        doc.querySelector('.cdk-overlay-pane');
    const show = () => {
        expanded.removeAttribute('hidden');
        trigger.setAttribute('aria-expanded', 'true');
    };
    trigger.addEventListener('click', show);
    if (!narrow) trigger.addEventListener('mouseover', show);
    for (const element of doc.querySelectorAll('[data-test-id^="bard-mode-option-"]')) {
        element.addEventListener('click', () => {
            doc.querySelectorAll('[data-test-id^="bard-mode-option-"]')
                .forEach(item => item.classList.remove('selected'));
            element.classList.add('selected');
        });
    }
    for (const element of [...doc.querySelectorAll('gem-menu-item')].filter(item =>
        /^(Low|Medium|High)$/.test(item.querySelector('.label')?.textContent || '')
    )) {
        element.addEventListener('click', () => {
            for (const other of doc.querySelectorAll('gem-menu-item')) {
                if (/^(Low|Medium|High)$/.test(other.querySelector('.label')?.textContent || '')) {
                    other.classList.remove('selected');
                }
            }
            element.classList.add('selected');
        });
    }
    const page = {
        evaluate: async (fn, arg) =>
            structuredClone(window.eval('(' + fn.toString() + ')(' +
                JSON.stringify(arg ?? null) + ')'))
    };
    return {
        page, dom,
        openMenu: async () => {},
        closeMenu: async () => {},
        sleep: async () => {}
    };
}

test('supports legacy modes, explicit levels and 4 Argon', () => {
    assert.equal(resolveGeminiWebMode('3.8').thinkingLevel, 'low');
    assert.equal(resolveGeminiWebMode('3.8-think').thinkingLevel, 'high');
    assert.equal(resolveGeminiWebMode('3.1-pro').thinkingLevel, 'low');
    assert.equal(resolveGeminiWebMode('4-argon-medium').modelId, ids[3]);
    assert.equal(resolveGeminiWebMode('4-high').thinkingLevel, 'high');
    assert.equal(resolveGeminiWebMode('unknown').mode, '3.8');
});

for (const layout of ['wide', 'narrow']) {
    test(layout + ': exposes hidden thinking submenu and selects correct model/level', async () => {
        const context = fixture(layout);
        const before = await readGeminiWebModeState(context.page);
        assert.equal(before.thinking.length, 0);
        assert.equal(before.selectedModelId, ids[1]);
        const result = await selectGeminiWebMode(
            context.page, '4-argon-medium', context
        );
        assert.equal(result.model, '4 Argon');
        assert.equal(result.thinkingLevel, 'medium');
        const after = await readGeminiWebModeState(context.page);
        assert.equal(after.selectedModelId, ids[3]);
        assert.equal(after.selectedThinking, 'medium');
    });

    test(layout + ': confirms selected items, not merely active/focused items', async () => {
        const context = fixture(layout);
        context.dom.window.document.querySelector(
            '[data-test-id="' + ids[0] + '"]'
        ).classList.add('active');
        assert.equal((await readGeminiWebModeState(context.page)).selectedModelId, ids[1]);
    });
}

test('changed Gemini model IDs still select by actual visible model label', async () => {
    const context = fixture('narrow');
    const item = context.dom.window.document.querySelector(
        '[data-test-id="' + ids[3] + '"]'
    );
    item.setAttribute('data-test-id', 'bard-mode-option-new-random-id');
    item.setAttribute('data-mode-id', 'new-random-id');
    const result = await selectGeminiWebMode(
        context.page, '4-argon-medium', context
    );
    assert.equal(result.model, '4 Argon');
    const state = await readGeminiWebModeState(context.page);
    assert.equal(state.selectedModelName, '4 Argon');
    assert.equal(state.selectedModelId, 'bard-mode-option-new-random-id');
});

test('an upsell mode is not selectable even if aria-disabled is false', async () => {
    const context = fixture('wide');
    const item = context.dom.window.document.querySelector(
        '[data-test-id="' + ids[3] + '"]'
    );
    item.setAttribute('data-test-id',
        'bard-mode-option-upsell_MODE_CATEGORY_ULTRA');
    item.setAttribute('data-mode-id', 'upsell_MODE_CATEGORY_ULTRA');
    item.setAttribute('aria-disabled', 'false');
    const before = await readGeminiWebModeState(context.page);
    assert.equal(before.models.find(option => option.name === '4 Argon').upsell, true);
    assert.equal(before.models.find(option => option.name === '4 Argon').disabled, true);
    await assert.rejects(
        selectGeminiWebMode(context.page, '4-argon-medium', context),
        error => error.code === 'GEMINI_WEB_MODEL_UPSELL' &&
            /upgrade required/i.test(error.message)
    );
    assert.equal((await readGeminiWebModeState(context.page)).selectedModelId, ids[1]);
});

test('Auto does not silently replace requested 3.8 Flash when unavailable', async () => {
    const context = fixture('narrow');
    const item = context.dom.window.document.querySelector(
        '[data-test-id="' + ids[1] + '"]'
    );
    item.textContent = 'Auto';
    item.setAttribute('data-test-id', 'bard-mode-option-cf41b0e0dd7d53e5');
    item.setAttribute('data-mode-id', 'cf41b0e0dd7d53e5');
    await assert.rejects(
        selectGeminiWebMode(context.page, '3.8', context),
        error => error.code === 'GEMINI_WEB_MODEL_NOT_FOUND' &&
            /Visible options:.*Auto/.test(error.message) &&
            /no model was substituted/.test(error.message)
    );
    assert.equal((await readGeminiWebModeState(context.page)).selectedModelName, 'Auto');
});
