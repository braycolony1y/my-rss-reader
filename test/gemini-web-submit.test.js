import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { waitForResponse } from '../src/ai/gemini-web.js';
import { classifyBrowserFailure } from '../src/browser/profile-recovery.js';

const source = readFileSync(new URL('../src/ai/gemini-web.js', import.meta.url), 'utf8');
const slice = (name, next) => source.slice(source.indexOf(`async function ${name}(`), source.indexOf(next));
const providerError = (_p, message, code) => { throw Object.assign(new Error(message), { code }); };
const waitFor = async (read, { timeoutMs = 50 } = {}) => {
    const end = Date.now() + Math.min(timeoutMs, 60);
    for (;;) { const value = await read(); if (value) return value; if (Date.now() > end) return null; await new Promise(r => setTimeout(r, 2)); }
};

function submit({ states, confirmAfterSends = Infinity, clicks = { send: 0, menu: 0, prompt: 0 } }) {
    let index = 0;
    const fn = vm.runInNewContext(`(${slice('submitPromptVerified', 'async function responseState').trim()})`, {
        console: { warn() {} }, providerError, waitFor, sleep: async () => {},
        readSubmissionState: async () => clicks.send >= confirmAfterSends
            ? { ...states[0], generating: true } : states[Math.min(index++, states.length - 1)],
        submitPrompt: async () => { clicks.send++; },
        closeModelMenu: async () => { clicks.menu++; },
        setPrompt: async () => { clicks.prompt++; }
    });
    return { run: () => fn({}, 'text'), clicks };
}
const idle = { editorLength: 10, userTurns: 0, modelTurns: 0, generating: false };

test('a confirmed send needs no retry', async () => {
    const { run, clicks } = submit({ states: [idle, { ...idle, userTurns: 1 }] });
    await run();
    assert.equal(clicks.send, 1);
});

test('a swallowed send click is retried after closing any open menu', async () => {
    const { run, clicks } = submit({ states: [idle], confirmAfterSends: 2 });
    await run();
    assert.equal(clicks.send, 2);
    assert.equal(clicks.menu, 1);
});

test('a prompt that never gets submitted fails closed with SUBMIT_NOT_CONFIRMED', async () => {
    const { run, clicks } = submit({ states: [idle] });
    await assert.rejects(run(), { code: 'GEMINI_WEB_SUBMIT_NOT_CONFIRMED' });
    assert.equal(clicks.send, 3);
});

test('an empty editor is refilled once, then fails with PROMPT_NOT_INSERTED', async () => {
    const empty = { ...idle, editorLength: 0 };
    const { run, clicks } = submit({ states: [empty] });
    await assert.rejects(run(), { code: 'GEMINI_WEB_PROMPT_NOT_INSERTED' });
    assert.equal(clicks.prompt, 1);
    assert.equal(clicks.send, 0);
});

test('waitForResponse fails fast when nothing starts, but not while generating', async () => {
    const quiet = { text: '', generating: false, alerts: '' };
    const started = Date.now();
    await assert.rejects(waitForResponse({ evaluate: async () => quiet }, '', 5000, false, 30),
        error => error.code === 'GEMINI_WEB_TIMEOUT' && error.responseStarted === false);
    assert.ok(Date.now() - started < 1500);
    await assert.rejects(waitForResponse({ evaluate: async () => ({ ...quiet, generating: true }) }, '', 400, false, 30),
        error => error.code === 'GEMINI_WEB_TIMEOUT');
});

test('CDP timeouts are page failures so recovery rebinds then restarts', () => {
    assert.equal(classifyBrowserFailure(Object.assign(new Error('x'), { code: 'cdp_timeout' })), 'page');
    assert.equal(classifyBrowserFailure(new Error('CDP command Runtime.evaluate timed out after 20s — the page may be blocked')), 'page');
    assert.equal(classifyBrowserFailure(new Error('ordinary')), null);
});

test('unsent text is cleared and dialogs dismissed before navigating away', () => {
    assert.match(source, /async function returnToGeminiChatHome\(page\) \{\s*await dismissNativeDialog\(page\);\s*await clearComposerDraft\(page\);/);
    assert.match(source, /async function resetGeminiJobPage\(page\) \{\s*await dismissNativeDialog\(page\);/);
    assert.match(source, /Page\.handleJavaScriptDialog/);
});
