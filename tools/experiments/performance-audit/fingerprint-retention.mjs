// Isolated, read-only reproduction of fingerprint ownership; never production GC.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { getHeapSpaceStatistics } from 'node:v8';
import { encodeStoredValue, decodeStoredValue } from '../../../src/database/stored-value.js';
import { rankingInputs, serializedRankingInput } from '../../../src/articles/ranking-input.js';
const [filename, variant, output] = process.argv.slice(2);
if (!global.gc || !['before', 'after'].includes(variant)) throw Error('Use isolated --expose-gc process with before/after');
let snapshot = JSON.parse(await readFile(filename, 'utf8'));
const stored = [snapshot.smartClusters, snapshot.smartRawArticles].map(encodeStoredValue);
const chars = [snapshot.smartClusters.length, snapshot.smartRawArticles.length];
snapshot = null;
let fingerprint;
const rows = [];
async function measure(label, elapsedMs, cpu) {
    await new Promise(resolve => setImmediate(resolve));
    global.gc();
    rows.push({label, elapsedMs, cpu, ...process.memoryUsage(), oldSpace: getHeapSpaceStatistics().filter(s => /old|large_object/.test(s.space_name))});
}
await measure('stored');
for (let cycle = 0; cycle < 5; cycle++) {
    const start = performance.now(), cpu = process.cpuUsage();
    if (variant === 'before') {
        let [publication, raw] = stored.map(decodeStoredValue);
        if (!fingerprint || fingerprint.publication !== publication || fingerprint.raw !== raw)
            fingerprint = {publication, raw, digest: createHash('sha256').update(publication).update(raw).digest('hex')};
        publication = raw = null;
    } else {
        let inputs = rankingInputs(...stored.map(serializedRankingInput));
        if (cycle === 0) inputs.read(); // First ranking still materializes worker input.
        fingerprint = {digest: inputs.digest};
        inputs = null;
    }
    await measure(`completed:${cycle}`, performance.now() - start, process.cpuUsage(cpu));
}
// Release only the fingerprint owner to establish causal retained-size evidence.
fingerprint = null;
await measure('fingerprint-released');
await writeFile(output, JSON.stringify({variant, chars, rows}, null, 2));
