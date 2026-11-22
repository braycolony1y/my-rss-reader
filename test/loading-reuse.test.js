import test from 'node:test';
import assert from 'node:assert/strict';
import { createParsedCache } from '../src/database/parsed-cache.js';

test('evicted shared parses reuse an externally owned graph without increasing the strong byte budget', () => {
 let now = 1;
 const cache = createParsedCache({maxBytes:12,maxEntries:4,ttlMs:10,now:()=>now});
 const first = {articles:[{title:'old'}]}, second = {articles:[]};
 cache.set('a','aaaa',first); cache.set('b','bbbb',second);
 assert.equal(cache.get('a','aaaa').parsed,first);
 assert.ok(cache.state().estimatedSourceBytes<=12);
 assert.equal(cache.state().recovered,1);
 cache.invalidate('a','new'); assert.equal(cache.get('a','aaaa'),undefined);
 cache.set('a','aaaa',first); now+=11; assert.equal(cache.get('a','aaaa'),undefined);
 cache.set('a','aaaa',first); cache.clear(); assert.equal(cache.get('a','aaaa'),undefined);
});
