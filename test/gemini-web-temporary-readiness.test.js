import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForGeminiTemporaryChatState } from '../src/ai/gemini-web-temporary-readiness.js';

const on = { found: true, knownState: true, enabled: true, activeTemporaryDom: true, iconName: 'close' };
const providerError = (_page, message, code) => { throw Object.assign(Error(message), { code }); };

test('Temporary Chat waits for both indicators to settle regardless of their arrival order', async () => {
    for (const partial of [{ activeTemporaryDom: false }, { iconName: 'gemini_chat_temp' }]) {
        let calls = 0;
        const result = await waitForGeminiTemporaryChatState({}, true, {
            timeoutMs: 1000, providerError, sleep: async () => {},
            readState: async () => ++calls === 1 ? { ...on, ...partial } : on
        });
        assert.equal(result, on);
        assert.equal(calls, 2);
    }
});

test('an incomplete Temporary Chat transition still fails closed', async () => {
    await assert.rejects(waitForGeminiTemporaryChatState({}, true, {
        timeoutMs: 5, providerError, sleep: async () => {},
        readState: async () => ({ ...on, activeTemporaryDom: false })
    }), { code: 'GEMINI_WEB_TEMP_CHAT_NOT_CONFIRMED' });
});

test('confirmation of normal chat still accepts the known disabled state', async () => {
    const off = { found: true, knownState: true, enabled: false };
    assert.equal(await waitForGeminiTemporaryChatState({}, false, {
        timeoutMs: 1000, providerError, sleep: async () => {}, readState: async () => off
    }), off);
});
