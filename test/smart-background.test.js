import test from 'node:test';
import assert from 'node:assert/strict';
import { startSmartSyncLoop, scheduleMonthlySourceEvaluation } from '../smart-news.js';
import { beginSmartRefresh, endSmartRefresh } from '../src/smart/refresh/coordination.js';
import { hasWorkerHeadroom } from '../src/observability/memory-budget.js';

function fakeTimers() {
  const timeouts = [], intervals = [];
  const originals = { setTimeout: globalThis.setTimeout, setInterval: globalThis.setInterval };
  let unrefs = 0;
  const capture = array => (callback, delay) => {
    array.push({ callback, delay });
    return { unref() { unrefs++; } };
  };
  globalThis.setTimeout = capture(timeouts);
  globalThis.setInterval = capture(intervals);
  return { timeouts, intervals, unrefs: () => unrefs, restore: () => Object.assign(globalThis, originals) };
}

async function settleUntil(predicate) {
  for (let i = 0; i < 100 && !predicate(); i++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(predicate(), 'Expected background stage was reached');
}

test('background source sync gives foreground refresh first claim and preserves defer timing', async () => {
  const timers = fakeTimers();
  beginSmartRefresh();
  try {
    void startSmartSyncLoop({}, {}, { put() { assert.fail('No background write while foreground work is active'); } }, () => assert.fail('No source fetch while foreground work is active'));
    assert.equal(timers.timeouts[0].delay, 10000);
    timers.timeouts[0].callback();
    await settleUntil(() => timers.timeouts.some(timer => timer.delay === 30000));
  } finally {
    endSmartRefresh();
    timers.restore();
  }
});

test('a foreground refresh starting during a background fetch drops the duplicate batch', async t => {
  if (!hasWorkerHeadroom(768)) return t.skip('Host has insufficient worker headroom');
  const timers = fakeTimers();
  const fetchBefore = globalThis.fetch;
  let lease = false, fetches = 0, writes = 0, resolutions = 0;
  globalThis.fetch = async () => {
    fetches++;
    beginSmartRefresh();
    lease = true;
    return { ok: true, text: async () => '<rss><item /></rss>' };
  };
  try {
    void startSmartSyncLoop({
      fastParseRSS: () => ({ items: [{ link: 'https://fixture.test/story', title: 'Story', pubDate: new Date().toISOString() }] }),
      resolveSmartArticleDestinations: () => { resolutions++; }
    }, {}, { put: () => { writes++; } }, async () => [{ title: 'Fixture', url: 'https://fixture.test/rss', category: 'news_global' }]);
    timers.timeouts[0].callback();
    await settleUntil(() => timers.timeouts.some(timer => timer.delay === 30000));
    assert.equal(fetches, 1);
    assert.equal(writes, 0);
    assert.equal(resolutions, 0);
  } finally {
    if (lease) endSmartRefresh();
    globalThis.fetch = fetchBefore;
    timers.restore();
  }
});

test('monthly source evaluation keeps initial/hourly timers and reads existing scores without AI work', async () => {
  const timers = fakeTimers();
  const reads = [];
  try {
    await scheduleMonthlySourceEvaluation({
      get: async key => { reads.push(key); return key === 'lastSourceEvalTime' ? Date.now() : { 'fixture.test': 1 }; },
      put: () => assert.fail('Fresh source scores should not be rewritten')
    }, () => assert.fail('Fresh source scores should not start evaluation'));
    assert.equal(timers.timeouts[0].delay, 10000);
    assert.equal(timers.intervals[0].delay, 3600000);
    assert.equal(timers.unrefs(), 2);
    await timers.timeouts[0].callback();
    assert.deepEqual(reads, ['lastSourceEvalTime', 'smartSourceScores']);
  } finally {
    timers.restore();
  }
});
