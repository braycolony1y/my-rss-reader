// Run with: node --expose-gc tools/experiments/benchmark-json-writer.mjs
// Synthetic data only; never reads or writes the live databases.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {writeJsonSnapshot} from '../../src/database/json-writer.js';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rss-write-benchmark-'));
try {
    const record = JSON.stringify({title: 'A news article', content: 'Article text with "quotes", accents tiếng Việt, and newlines.\n'.repeat(22)});
    const snapshot = {smartClusters: '[' + Array(40000).fill(record).join(',') + ']', metadata: '{"state":"ready"}'};
    for (const [name, write] of [
        ['whole-database serialization', (file, value) => fs.writeFile(file, JSON.stringify(value))],
        ['chunked database serialization', writeJsonSnapshot]
    ]) {
        global.gc?.();
        let maxPauseMs = 0, lastTick = performance.now();
        const interval = setInterval(() => {const at = performance.now(); maxPauseMs = Math.max(maxPauseMs, at - lastTick); lastTick = at;}, 2);
        const started = performance.now();
        const file = path.join(directory, 'snapshot.json');
        await write(file, snapshot);
        clearInterval(interval);
        console.log(JSON.stringify({name, sizeMB: ((await fs.stat(file)).size / 1024 / 1024).toFixed(1), totalMs: Math.round(performance.now() - started), maxPauseMs: Math.round(maxPauseMs)}));
    }
} finally {
    await fs.rm(directory, {recursive: true, force: true});
}
