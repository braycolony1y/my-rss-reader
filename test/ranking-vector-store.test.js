import test from 'node:test';
import assert from 'node:assert/strict';
import { createVectorStore } from '../src/ranking/vector-store.js';

const encode = values => Buffer.from(new Float32Array(values).buffer).toString('base64');
const article = id => ({ id });
const keyOf = a => a.id;

test('two concurrent warm() calls for the same articles cause one base scan', async () => {
  let scans = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const load = async (file, keys, importEntries) => {
    scans++; await gate;
    importEntries(Object.fromEntries([...keys].filter(k => k !== 'missing').map(k => [k, encode([1, 0])])));
  };
  const store = createVectorStore({ load, keyOf });
  const list = [article('a'), article('b'), article('missing')];
  const first = store.warm(list);
  const second = store.warm(list);
  const third = store.warm([article('a'), article('c')]); // adds one new key while in flight
  release();
  await Promise.all([first, second, third]);
  assert.equal(scans, 2, 'one scan for the shared keys, one for the genuinely new key');
  assert.ok(store.get(article('a')) && store.get(article('c')));
  assert.equal(store.get(article('missing')), null);
});

test('queued keys already resolved by the in-flight load are not rescanned', async () => {
  let scans = 0;
  const load = async (file, keys, importEntries) => {
    scans++; await new Promise(r => setImmediate(r));
    importEntries(Object.fromEntries([...keys].map(k => [k, encode([0, 1])])));
  };
  const store = createVectorStore({ load, keyOf });
  const p1 = store.warm([article('a')]);
  const p2 = store.warm([article('b')]);
  store.warm([article('b')]);
  await Promise.all([p1, p2]);
  assert.equal(scans, 2);
});

test('a loader that throws leaves the store usable', async () => {
  let fail = true; const originalWarn = console.warn; console.warn = () => {};
  const load = async (file, keys, importEntries) => {
    if (fail) throw new Error('boom');
    importEntries(Object.fromEntries([...keys].map(k => [k, encode([1, 0])])));
  };
  let time = 0;
  const store = createVectorStore({ load, keyOf, now: () => time });
  try {
    await store.warm([article('a')]);
    assert.equal(store.get(article('a')), null);
    assert.equal(store.stats().loading, false);
    fail = false; time += 6 * 60000; // past the miss TTL
    await store.warm([article('a')]);
    assert.ok(store.get(article('a')));
  } finally { console.warn = originalWarn; }
});
