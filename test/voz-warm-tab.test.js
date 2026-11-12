import test from 'node:test';
import assert from 'node:assert/strict';
import { createVozWarmTab, VOZ_WARM_ORIGIN, keepsBrowserOriginWarm } from '../src/browser/voz-warm-tab.js';
import { createFetchTabIdleScheduler } from '../src/browser/fetch-tab-idle.js';
import { createBrowserFetchQueue } from '../src/browser/fetch-queue.js';

function fixture() {
    const state = { browserReady: false };
    const tracker = { pending: 0 };
    tracker.queue = createBrowserFetchQueue({ canFetchConcurrently: () => !tracker.maintenanceActive });
    const calls = { prepared: 0, evaluated: 0, timers: [], warnings: [] };
    let origin = 'null';
    let probeError = false;
    let gate;
    const service = createVozWarmTab({
        getState: async url => { assert.equal(url, VOZ_WARM_ORIGIN); return state; },
        getTracker: () => tracker,
        ensureReady: async () => { calls.prepared++; if (gate) await gate; state.browserReady = true; origin = VOZ_WARM_ORIGIN; },
        evaluate: async () => { calls.evaluated++; if (probeError) throw new Error('Missing target'); return origin; },
        cancelIdleClose: () => {},
        withBudget: async (run, priority) => { assert.equal(priority, 4); return run(); },
        setTimer: (run, ms) => { calls.timers.push({ run, ms }); return { unref() {} }; },
        clearTimer: () => { calls.stopped = true; },
        logger: { warn: (...args) => calls.warnings.push(args) }
    });
    return { service, state, tracker, calls,
        loseTab() { origin = 'null'; },
        failProbe() { probeError = true; },
        block(promise) { gate = promise; }
    };
}

test('startup prepares the shared VOZ tab once and keeps renewing it without navigation', async () => {
    const f = fixture();
    f.service.start(); f.service.start();
    await f.service.maintain();
    assert.equal(f.calls.timers.length, 1);
    assert.equal(f.calls.timers[0].ms, 30_000);
    assert.equal(f.calls.prepared, 1);
    for (let i = 0; i < 5; i++) await f.service.maintain();
    assert.equal(f.calls.prepared, 1);
    assert.equal(f.calls.evaluated, 6);
    assert.equal(f.tracker.pending, 0);
    f.service.stop();
    assert.equal(f.calls.stopped, true);
});

test('a closed or rebound blank tab is recovered through the same transport state', async () => {
    const f = fixture();
    await f.service.maintain();
    f.loseTab();
    await f.service.maintain();
    assert.equal(f.calls.prepared, 2);
    f.failProbe();
    await f.service.maintain();
    assert.equal(f.calls.prepared, 3);
});

test('source work takes precedence; warm-up coalesces and prevents concurrent recovery/fetch', async () => {
    const f = fixture();
    f.tracker.pending = 1;
    assert.equal(await f.service.maintain(), false);
    assert.equal(f.calls.evaluated, 0);
    f.tracker.pending = 0;
    let release;
    f.block(new Promise(resolve => { release = resolve; }));
    const warm = f.service.maintain();
    assert.equal(f.service.maintain(), warm);
    let fetched = false;
    const fetch = f.tracker.queue.run('article', async () => { fetched = true; }, 0);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(fetched, false);
    release();
    await Promise.all([warm, fetch]);
    assert.equal(fetched, true);
    assert.equal(f.tracker.pending, 0);
    assert.equal(f.tracker.maintenanceActive, false);
});

test('preparation failures release bookkeeping and allow the next retry', async () => {
    const f = fixture();
    f.block(Promise.reject(new Error('Bridge offline')));
    assert.equal(await f.service.maintain(), false);
    assert.equal(f.tracker.pending, 0);
    assert.equal(f.tracker.maintenanceActive, false);
    assert.equal(f.calls.warnings.length, 1);
    f.block(null);
    assert.equal(await f.service.maintain(), true);
});

function idleFixture(origin) {
    const tracker = { pending: 0 };
    const state = {};
    const calls = { timers: [], reset: [], deleted: 0 };
    const schedule = createFetchTabIdleScheduler({
        states: new Map([[origin, state]]), trackers: new Map([[origin, tracker]]),
        cancelIdleClose: () => { tracker.closeTimer = null; },
        originPinned: () => Boolean(tracker.pinned),
        resetPage: async (...args) => calls.reset.push(args),
        maybeDeleteTracker: () => calls.deleted++,
        setTimer: (run, ms) => { calls.timers.push({ run, ms }); return { unref() {} }; },
        logger: { log() {} }
    });
    return { tracker, state, calls, schedule: () => schedule(origin, tracker) };
}

test('VOZ stays open after source work, viewer release and viewer expiry', () => {
    const f = idleFixture(VOZ_WARM_ORIGIN);
    for (let i = 0; i < 3; i++) f.schedule();
    assert.equal(f.calls.timers.length, 0);
    assert.equal(f.calls.reset.length, 0);
    assert.equal(keepsBrowserOriginWarm('https://voz.vn.attacker.test'), false);
    assert.equal(keepsBrowserOriginWarm('https://other.test'), false);
});

test('other sources still close their exact owned tab after 60 idle seconds', async () => {
    const f = idleFixture('https://other.test');
    f.schedule();
    assert.equal(f.calls.timers[0].ms, 60_000);
    f.calls.timers[0].run();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(f.calls.reset, [[f.state, { closeTab: true, reason: '60s fetch-idle cleanup' }]]);
    assert.equal(f.calls.deleted, 1);
});

test('idle cleanup preserves pages with new work or active viewers', () => {
    const f = idleFixture('https://other.test');
    f.schedule();
    f.tracker.pending = 1;
    f.calls.timers[0].run();
    assert.equal(f.calls.reset.length, 0);
    f.tracker.pending = 0; f.tracker.pinned = true;
    f.schedule();
    assert.equal(f.calls.timers.length, 1);
});
