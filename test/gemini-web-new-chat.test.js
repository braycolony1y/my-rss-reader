import test from 'node:test';
import assert from 'node:assert/strict';
import {
    confirmFreshNormalChat, geminiHomeUrl, isFreshNormalChatState
} from '../src/ai/gemini-web-new-chat.js';

const freshState = (over = {}) => ({
    pathname: '/u/1/app', editorFound: true, editorEmpty: true,
    hasTurns: false, enabled: false, ...over
});
const conversationState = () => freshState({ pathname: '/u/1/app/abc123', hasTurns: true });
const providerError = (page, message, code) => { throw Object.assign(new Error(message), { code }); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, Math.min(ms, 5)));
const fast = { settleMs: 40, clickMs: 40, confirmMs: 60 };

function harness({ initial, afterClick, afterHome, clickable = false }) {
    const calls = [];
    let state = initial;
    const deps = {
        ...fast, sleep, providerError,
        readState: async () => state,
        clickNewChat: async () => {
            calls.push('click');
            if (clickable) state = afterClick ?? state;
            return clickable;
        },
        goHome: async () => { calls.push('home'); state = afterHome ?? state; }
    };
    return { calls, deps };
}

test('already-fresh chat with hidden New chat button is confirmed without any click or reload', async () => {
    const { calls, deps } = harness({ initial: freshState() });
    const started = Date.now();
    const result = await confirmFreshNormalChat({}, deps);
    assert.equal(result.pathname, '/u/1/app');
    assert.deepEqual(calls, []);
    assert.ok(Date.now() - started < 30);
});

test('existing conversation with hidden New chat button falls back to the base app URL', async () => {
    const { calls, deps } = harness({
        initial: conversationState(), afterHome: freshState(), clickable: false
    });
    const result = await confirmFreshNormalChat({}, deps);
    assert.equal(result.pathname, '/u/1/app');
    assert.deepEqual(calls, ['click', 'home']);
});

test('existing conversation uses the New chat button when available and does not reload', async () => {
    const { calls, deps } = harness({
        initial: conversationState(), afterClick: freshState(), clickable: true
    });
    await confirmFreshNormalChat({}, deps);
    assert.deepEqual(calls, ['click']);
});

test('truly unconfirmable pages still fail closed with GEMINI_WEB_NEW_CHAT_FAILED', async () => {
    for (const initial of [conversationState(), freshState({ editorEmpty: false }), freshState({ enabled: true })]) {
        const { calls, deps } = harness({ initial });
        await assert.rejects(confirmFreshNormalChat({}, deps), { code: 'GEMINI_WEB_NEW_CHAT_FAILED' });
        assert.deepEqual(calls, ['click', 'home']);
    }
});

test('fresh-chat judgement requires /app route, empty composer, no turns and no Temporary Chat', () => {
    assert.equal(isFreshNormalChatState(freshState()), true);
    assert.equal(isFreshNormalChatState(freshState({ pathname: '/app' })), true);
    assert.equal(isFreshNormalChatState(freshState({ pathname: '/u/1/app/abc' })), false);
    assert.equal(isFreshNormalChatState(freshState({ editorFound: false })), false);
    assert.equal(isFreshNormalChatState(freshState({ editorEmpty: false })), false);
    assert.equal(isFreshNormalChatState(freshState({ hasTurns: true })), false);
    assert.equal(isFreshNormalChatState(freshState({ enabled: true })), false);
    assert.equal(isFreshNormalChatState(null), false);
});

test('base app URL keeps the same /u/N account', () => {
    const configured = 'https://gemini.google.com/u/1/app';
    assert.equal(geminiHomeUrl('https://gemini.google.com/u/1/app/abc123', configured), 'https://gemini.google.com/u/1/app');
    assert.equal(geminiHomeUrl('https://gemini.google.com/u/2/app/xyz', configured), 'https://gemini.google.com/u/2/app');
    assert.equal(geminiHomeUrl('not a url', configured), 'https://gemini.google.com/u/1/app');
    assert.equal(geminiHomeUrl('https://gemini.google.com/app', 'https://gemini.google.com/app'), 'https://gemini.google.com/app');
});

test('ambiguous Temporary Chat indicators are never treated as a fresh normal chat', () => {
    assert.equal(isFreshNormalChatState(freshState({ enabled: true })), false);
});
