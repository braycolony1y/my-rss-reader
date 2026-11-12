import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

const output = process.argv[2];
if (!output) throw Error('Usage: sqlite-reader.mjs OUTPUT');
const base = process.env.READER_URL || 'http://127.0.0.1:3000';
const get = async route => {
    const response = await fetch(base + route, { headers: { Cookie: 'auth=true' }, signal: AbortSignal.timeout(90000) });
    assert.equal(response.status, 200);
    return response.json();
};
const list = await get('/api/data?filterType=board&limit=1');
assert.ok(list.articles?.[0]?.link);
const started = performance.now();
const article = await get('/api/article-content?url=' + encodeURIComponent(list.articles[0].link));
assert.ok(article.content?.length > 100);
const report = { cachedBoardReader: true, contentBytes: Buffer.byteLength(article.content), hasThreadPosts: article.content.includes('voz-post'), ms: performance.now() - started };
await fs.writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
