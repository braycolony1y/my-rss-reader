import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { resolveGeminiWebMode, readGeminiWebModeState, selectGeminiWebMode } from '../src/ai/gemini-web-mode.js';

const modelIds = [
    'bard-mode-option-8c46e95b1a07cecc',
    'bard-mode-option-56fdd199312815e2',
    'bard-mode-option-e6fa609c3fa255c0'
];
const fixture = () => {
    const dom = new JSDOM(`<div data-test-id="gem-mode-menu">
      <div role="menuitem" data-test-id="${modelIds[0]}"><span class="label">3.5 Flash-Lite</span> Fastest answers</div>
      <div role="menuitem" data-test-id="${modelIds[1]}" class="selected"><span class="label">3.8 Flash</span> All-around help</div>
      <div role="menuitem" data-test-id="${modelIds[2]}"><span class="label">3.1 Pro</span> Advanced reasoning</div>
      <div role="menuitem"><span class="label">Low</span> Quick and efficient</div>
      <div role="menuitem"><span class="label">Medium</span> Balanced depth</div>
      <div role="menuitem" class="selected"><span class="label">High</span> Extra thorough</div>
    </div>`, { runScripts: 'outside-only' });
    const { window } = dom;
    // JSDOM does not calculate layout geometry; simulate a visible menu.
    window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 300, height: 320 });
    const menu = window.document.querySelector('[data-test-id="gem-mode-menu"]');
    for (const node of menu.querySelectorAll('[role="menuitem"]')) {
        node.addEventListener('click', () => {
            const isModel = !!node.getAttribute('data-test-id');
            const selector = isModel ? '[data-test-id^="bard-mode-option-"]' : '[role="menuitem"]:not([data-test-id])';
            for (const option of menu.querySelectorAll(selector)) option.classList.remove('selected');
            node.classList.add('selected');
        });
    }
    // Browser protocol results cross realms by value; JSDOM eval alone leaves
    // browser Array prototypes attached and makes strict Node assertions fail.
    const page = { evaluate: async (fn, arg) => structuredClone(window.eval(`(${fn.toString()})(${JSON.stringify(arg ?? null)})`)) };
    const openMenu = async () => {};
    const closeMenu = async () => {};
    const sleep = async () => {};
    return { dom, page, openMenu, closeMenu, sleep };
};

test('legacy and explicit mode names map to model and thinking level', () => {
    assert.equal(resolveGeminiWebMode('3.8').thinkingLevel, 'low');
    assert.equal(resolveGeminiWebMode('3.8-think').thinkingLevel, 'high');
    assert.equal(resolveGeminiWebMode('3.1-pro').thinkingLevel, 'low');
    assert.equal(resolveGeminiWebMode('3.1-pro-think').thinkingLevel, 'high');
    assert.equal(resolveGeminiWebMode('3.8-medium').thinkingLevel, 'medium');
    assert.equal(resolveGeminiWebMode('3.5-flash-lite-high').modelId, modelIds[0]);
    assert.equal(resolveGeminiWebMode('unknown').mode, '3.8');
});

test('reads all three thinking levels independently of selected model', async () => {
    const { page } = fixture();
    const state = await readGeminiWebModeState(page);
    assert.deepEqual(state.thinking.map(x => x.level), ['low', 'medium', 'high']);
    assert.equal(state.selectedModelId, modelIds[1]);
    assert.equal(state.selectedThinking, 'high');
});

test('switches model and thinking independently and confirms both', async () => {
    const { page, openMenu, closeMenu, sleep } = fixture();
    const result = await selectGeminiWebMode(page, '3.1-pro-medium', { openMenu, closeMenu, sleep });
    assert.equal(result.model, '3.1 Pro');
    assert.equal(result.thinkingLevel, 'medium');
    const after = await readGeminiWebModeState(page);
    assert.equal(after.selectedModelId, modelIds[2]);
    assert.equal(after.selectedThinking, 'medium');
});

test('does not click if model and thinking are already correct', async () => {
    const { page, dom, openMenu, closeMenu, sleep } = fixture();
    let clicks = 0;
    dom.window.document.querySelector('[data-test-id="gem-mode-menu"]')
        .addEventListener('click', () => { clicks++; });
    const result = await selectGeminiWebMode(page, '3.8-high', { openMenu, closeMenu, sleep });
    assert.equal(result.thinkingLevel, 'high');
    assert.equal(clicks, 0);
});
