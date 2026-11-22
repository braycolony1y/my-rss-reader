import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { patchBackground } from '../ops/maintenance/opencli-blank-tabs/install.mjs';

const fixture = readFileSync(new URL('./fixtures/opencli/release-lease.js.txt', import.meta.url), 'utf8');
const guard = readFileSync(new URL('../ops/maintenance/opencli-blank-tabs/guard.js', import.meta.url), 'utf8');

function harness() {
  const tabs = new Map();
  const removed = [];
  const detached = [];
  const sessions = new Map();
  const active = new Map();
  let now = 1_000;
  let failRemove = false;
  let beforeGet = () => {};
  const context = vm.createContext({
    console: { log() {}, warn() {} },
    Date: { now: () => now },
    clearTimeout() {},
    automationSessions: sessions,
    activeCommandCounts: active,
    ownedContainers: { automation: { windowId: 90 } },
    interactiveGroupLedger: new Set([10]),
    sessionOverrides: new Map(),
    IDLE_TIMEOUT_NONE: -1,
    workerReady: new Promise(() => {}),
    withLeaseMutation: fn => fn(),
    safeDetach: async id => detached.push(id),
    evictTab() {},
    scheduleIdleAlarm() {},
    persistRuntimeState: async () => {},
    chrome: {
      tabs: {
        query: async () => [...tabs.values()].map(tab => ({ ...tab })),
        get: async id => {
          beforeGet(id);
          if (!tabs.has(id)) throw new Error('No tab');
          return tabs.get(id);
        },
        remove: async id => {
          if (failRemove) throw new Error('Remove failed');
          removed.push(id);
          tabs.delete(id);
        },
        update: () => assert.fail('Closing a tab must never navigate or focus it')
      },
      tabGroups: { query: async () => [{ id: 10, title: 'OpenCLI Browser' }] },
      alarms: { onAlarm: { addListener() {} } }
    }
  });
  vm.runInContext(patchBackground(fixture, guard), context);
  // Resolve workerReady only for explicit sweeps; skip automatic startup in this harness.
  context.workerReady = Promise.resolve();
  return {
    tabs, removed, detached, sessions, active,
    add(id, extra = {}) { tabs.set(id, { id, url: 'about:blank', status: 'complete', windowId: 1, groupId: 10, ...extra }); },
    advance() { now += 61_000; },
    failRemove() { failRemove = true; },
    beforeGet(fn) { beforeGet = fn; },
    release: key => context.releaseLease(key, 'tab close'),
    sweep: () => context.cleanupOpenCliBlankTabs()
  };
}

test('closing the final owned tab removes it rather than leaving a placeholder', async () => {
  const h = harness();
  h.add(1, { url: 'https://example.com' });
  h.sessions.set('reader', { owned: true, preferredTabId: 1, windowId: 1 });
  await h.release('reader');
  assert.deepEqual(h.removed, [1]);
  assert.equal(h.sessions.size, 0);
});

test('borrowed user tabs are detached but never removed', async () => {
  const h = harness();
  h.add(1);
  h.sessions.set('reader', { owned: false, preferredTabId: 1, windowId: 1 });
  await h.release('reader');
  assert.deepEqual(h.removed, []);
  assert.deepEqual(h.detached, [1]);
});

test('failed tab removal preserves ownership for a later retry', async () => {
  const h = harness();
  h.add(1);
  h.sessions.set('reader', { owned: true, preferredTabId: 1, windowId: 1 });
  h.failRemove();
  await assert.rejects(h.release('reader'), /Remove failed/);
  assert.equal(h.sessions.has('reader'), true);
});

test('cleanup only removes old unleased blanks belonging to OpenCLI', async () => {
  const h = harness();
  h.add(1); // abandoned grouped placeholder
  h.add(2, { groupId: -1, windowId: 90 }); // adapter placeholder
  h.add(3, { url: 'https://example.com' });
  h.add(4, { groupId: -1 }); // user blank
  h.add(5, { pendingUrl: 'https://example.com' });
  h.add(6, { status: 'loading' });
  h.add(7, { pinned: true });
  h.add(8);
  h.add(9);
  h.sessions.set('owned', { owned: true, preferredTabId: 8 });
  h.sessions.set('borrowed', { owned: false, preferredTabId: 9 });
  await h.sweep();
  assert.deepEqual(h.removed, []);
  h.advance();
  await h.sweep();
  assert.deepEqual(h.removed, [1, 2]);
});

test('cleanup rechecks navigation immediately before removal', async () => {
  const h = harness();
  h.add(1);
  await h.sweep();
  h.advance();
  h.beforeGet(id => { h.tabs.get(id).url = 'https://example.com'; });
  await h.sweep();
  assert.deepEqual(h.removed, []);
});

test('cleanup preserves the active blank tab so a background worker cannot become selected', async () => {
  const h = harness();
  h.add(1, { active: true });
  await h.sweep(); h.advance(); await h.sweep();
  assert.deepEqual(h.removed, []);
});

test('busy unrelated sessions do not starve orphan cleanup', async () => {
  const h = harness();
  h.add(1);
  h.active.set('busy-reader', 1);
  await h.sweep();
  h.advance();
  await h.sweep();
  assert.deepEqual(h.removed, [1]);
});

test('a tab leased after observation is protected', async () => {
  const h = harness();
  h.add(1);
  await h.sweep();
  h.advance();
  h.beforeGet(() => h.sessions.set('new-reader', { owned: true, preferredTabId: 1 }));
  await h.sweep();
  assert.deepEqual(h.removed, []);
});

test('installer is idempotent and refuses unfamiliar bridge code', () => {
  const patched = patchBackground(fixture, guard);
  assert.equal(patchBackground(patched, guard), patched);
  assert.throws(() => patchBackground('unknown code', guard), /Unsupported/);
});
