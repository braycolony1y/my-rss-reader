// Same permanent identity set and source additions, actual Board observation
// and keyed-overlay writer. No live state is copied or changed.
import fs from 'node:fs/promises';
import {createBoardCache} from '../../../src/board/cache-service.js';
import {createCacheObservationBatch} from '../../../src/feeds/cache-observation-batch.js';
import {createKeyedOverlay} from '../../../src/database/keyed-overlay.js';
import {writeJsonSnapshot} from '../../../src/database/json-writer.js';
const count = Number(process.env.AUDIT_LEDGER_IDENTITIES || 200000);
const io = async () => Number((await fs.readFile('/proc/self/io', 'utf8')).match(/^write_bytes: (\d+)/m)[1]);
const rows = [];
for (const variant of process.argv[3] ? [process.argv[3]] : ['before', 'after']) {
    const directory = await fs.mkdtemp('/tmp/rss-ledger-cycle-');
    let ledger = {initialized_at: 1, dismissals: {}, articles: Object.fromEntries(Array.from({length: count}, (_, i) =>
        [`https://example.test/permanent-news-identity/${i}`, {first_seen_at: 1700000000000, last_seen_at: 1700000000000, auto_added: false}]))};
    let revision = 0, commits = 0;
    const overlay = createKeyedOverlay({filename: directory + '/state.json', allowedKeys: new Set(['cacheIdentityLedger']),
        writeJson: async (file, data) => {await writeJsonSnapshot(file + '.tmp', data); await fs.rename(file + '.tmp', file);}});
    const db = {get: async key => key === 'cacheIdentityLedger' ? ledger : key === 'cacheAutoRules' ? [] : {},
        put: async (key, value) => {
            if (key !== 'cacheIdentityLedger') throw Error('Unexpected write: ' + key);
            await overlay.write({revision: ++revision, values: {[key]: value}, changedKeys: [key]});
            ledger = JSON.parse(value); commits++;
        }};
    const board = createBoardCache({env: {RSS_DATA: db}, directory, now: () => 1800000000000});
    const startBytes = await io(), start = performance.now(), cycles = [];
    for (let cycle = 0; cycle < 4; cycle++) {
        const batch = createCacheObservationBatch(board.observe);
        for (let feed = 0; feed < 8; feed++) {
            const articles = [{link: `https://example.test/new/${cycle}/${feed}`, title: 'New article', feedUrl: `https://example.test/feed/${feed}`}];
            if (variant === 'before') await board.observe(articles); else batch.add(articles);
        }
        await batch.flush();
        await new Promise(resolve => setImmediate(resolve)); global.gc?.();
        cycles.push({cycle, ...process.memoryUsage()});
    }
    const recovered = JSON.parse((await overlay.load()).values.cacheIdentityLedger);
    if (Object.keys(recovered.articles).length !== count + 32) throw Error('Identity loss');
    rows.push({variant, identities: count, commits, ms: performance.now() - start, physicalBytes: await io() - startBytes, cycles});
    console.log(JSON.stringify(rows.at(-1)));
    await fs.writeFile(process.argv[2], JSON.stringify(rows, null, 2));
    await fs.rm(directory, {recursive: true, force: true});
}
