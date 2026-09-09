import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForPdfAssets } from '../src/exports/pdf-renderer.js';

test('PDF asset deadline runs outside the page even when page timers cannot execute', async () => {
    let polls = 0, stopped = false, detached = false;
    const page = { evaluate: async fn => { assert.doesNotMatch(fn.toString(), /setTimeout|new Promise/); polls++; return false; },
        createCDPSession: async () => ({ send: async method => { assert.equal(method, 'Page.stopLoading'); stopped = true; }, detach: async () => { detached = true; } }) };
    await waitForPdfAssets(page, { timeoutMs: 25, pollMs: 5 });
    assert.ok(polls > 0); assert.equal(stopped, true); assert.equal(detached, true);
});

test('loaded PDF assets do not wait for the deadline or cancel finished requests', async () => {
    await waitForPdfAssets({ evaluate: async () => true, createCDPSession: () => { throw new Error('No cancellation needed'); } });
});
