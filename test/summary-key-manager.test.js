import test from 'node:test';
import assert from 'node:assert/strict';

import { GeminiKeyManager } from '../summary-engine.js';

test('Gemini key manager returns no key while every configured key is cooling down', () => {
    const manager = new GeminiKeyManager();
    manager.keys = [
        { key: 'test-one', index: 0, status: 'Active', requestsToday: 0 },
        { key: 'test-two', index: 1, status: 'Standby', requestsToday: 0 }
    ];
    manager.activeIdx = 0;

    manager.reportError({ status: 429, message: 'quota' });
    assert.equal(manager.getCurrentKeyObj().index, 1);

    manager.reportError({ status: 429, message: 'quota' });
    assert.equal(manager.getCurrentKeyObj(), null);
    assert.equal(manager.keys[0].status, 'Rate Limited');
    assert.equal(manager.keys[1].status, 'Rate Limited');

    manager.keys[1].cooldownUntil = Date.now() - 1;
    assert.equal(manager.getCurrentKeyObj().index, 1);
});

test('a newly added key becomes active immediately without duplicating existing keys', () => {
    const manager = new GeminiKeyManager();
    manager.keys = [
        { key: 'existing-key-value', index: 0, status: 'Rate Limited', requestsToday: 4 }
    ];
    manager.activeIdx = 0;

    const added = manager.addKey('new-key-value-that-is-long-enough');
    assert.deepEqual(added, { added: true, index: 1, active: true });
    assert.equal(manager.getCurrentKeyObj().key, 'new-key-value-that-is-long-enough');
    assert.equal(manager.keys.length, 2);

    const duplicate = manager.addKey('new-key-value-that-is-long-enough');
    assert.deepEqual(duplicate, { added: false, index: 1, active: true });
    assert.equal(manager.keys.length, 2);
});
