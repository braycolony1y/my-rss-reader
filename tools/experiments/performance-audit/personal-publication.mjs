import { performance } from 'node:perf_hooks';
import { writeFile } from 'node:fs/promises';
import { confirmFeedback, getPersonalStore, undoFeedback } from '../../../src/smart/feedback/store.js';
import { semantics } from '../../../src/smart/feedback/semantics.js';
import { filterPublishedView } from '../../../src/smart/prefilter/published-view.js';

// Same articles and persisted personalization contents for each implementation.
const reports = [];
for (let run = 0; run < 5; run++) {
    let writes = 0, bytes = 0;
    const db = { async get() { return null; }, async put(key, value) { writes++; bytes += Buffer.byteLength(value); } };
    const article = i => ({ title: `VinFast monthly deliveries increase ${i}`, link: `https://example.test/${i}`,
        content: 'Monthly vehicle delivery numbers.', topStory: { feed: 'tech_vietnam' } });
    const seed = article('seed');
    const event = await confirmFeedback(db, { article: seed, surface: 'smart_top',
        selectedReasons: [semantics.pool(seed).find(reason => reason.rule.dimension === 'entity')] });
    const snapshot = { articles: Array.from({ length: 100 }, (_, i) => article(i)) };
    writes = 0; bytes = 0;
    const start = performance.now();
    const filtered = await filterPublishedView(db, snapshot);
    const elapsedMs = performance.now() - start;
    if (filtered.articles.length !== 0 || (await getPersonalStore(db)).state.decisions.length !== 101) throw Error('Filtering mismatch');
    reports.push({ run, elapsedMs, writes, bytes });
    await undoFeedback(db, event.id);
    if ((await filterPublishedView(db, snapshot)).articles.length !== 100) throw Error('Undo mismatch');
}
await writeFile(process.argv[2], JSON.stringify(reports, null, 2));
console.log(JSON.stringify(reports));
