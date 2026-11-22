import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readGeminiPageReadiness, waitForGeminiPageReady } from '../src/ai/gemini-web-page-readiness.js';

const providerError = async (_page, message, code) => { throw Object.assign(Error(message), { code }); };
const options = { timeoutMs: 500, sleep: async () => {}, providerError };

test('a short ready Gemini page is accepted by its visible composer', async () => {
    const dom = new JSDOM('<div role="textbox" contenteditable="true"> </div>', {
        url: 'https://gemini.google.com/u/1/app', runScripts: 'outside-only'
    });
    dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 300, height: 40 });
    await new Promise(resolve => dom.window.addEventListener('load', resolve, { once: true }));
    const page = { evaluate: async fn => structuredClone(dom.window.eval(`(${fn.toString()})()`)) };
    const state = await waitForGeminiPageReady(page, options);
    assert.equal(state.composerReady, true);
    for (const attribute of ['hidden', 'disabled', 'readonly', 'aria-disabled']) {
        const input = dom.window.document.querySelector('[contenteditable]');
        if (attribute === 'hidden') input.style.display = 'none';
        else if (attribute === 'disabled' || attribute === 'readonly') input[attribute === 'readonly' ? 'readOnly' : 'disabled'] = true;
        else input.setAttribute(attribute, 'true');
        assert.equal((await page.evaluate(readGeminiPageReadiness)).composerReady, false);
        input.style.display = ''; input.disabled = false; input.readOnly = false; input.removeAttribute('aria-disabled');
    }
    dom.window.close();
});

test('readiness waits through loading, missing composer, and transient evaluation failure', async () => {
    const states = [Error('navigation'), { readyState: 'loading', composerReady: true },
        { readyState: 'complete', composerReady: false }, { readyState: 'complete', composerReady: true }];
    let calls = 0;
    const state = await waitForGeminiPageReady({ evaluate: async () => {
        const next = states[calls++]; if (next instanceof Error) throw next; return next;
    } }, options);
    assert.equal(state.composerReady, true);
    assert.equal(calls, 4);
});

test('login and timeout retain distinct diagnostic errors', async () => {
    await assert.rejects(waitForGeminiPageReady({ evaluate: async () => ({ url: 'https://accounts.google.com/login' }) }, options), { code: 'GEMINI_WEB_LOGIN_REQUIRED' });
    await assert.rejects(waitForGeminiPageReady({ evaluate: async () => ({ readyState: 'complete', composerReady: false }) }, { ...options, timeoutMs: 5 }), { code: 'GEMINI_WEB_PAGE_TIMEOUT' });
});
