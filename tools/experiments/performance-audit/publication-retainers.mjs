// Isolated ownership experiment: pinned publications must not own old personal
// histories. GC is diagnostic only; this never runs in the production service.
import { writeHeapSnapshot } from 'node:v8';
import { filterPublishedView } from '../../../src/smart/prefilter/published-view.js';
import { getPersonalStore } from '../../../src/smart/feedback/store.js';
const db = { async get() { return null; }, async put() {} };
const store = await getPersonalStore(db);
globalThis.auditPinnedPublications = [];
const refs = [];
for (let cycle = 0; cycle < 5; cycle++) {
    await store.transact(state => {
        state.decisions = Array.from({length: 20000}, (_, i) => ({
            active: false, title: `Decision ${i}`, identity: {keys: [`https://example.test/${i}`]},
            humanReason: `Generation ${cycle}: ` + 'Historical decision evidence. '.repeat(20)
        }));
    });
    const snapshot = {articles: [{title: 'Published article', link: 'https://example.test/story', topStory: {feed: 'tech_global'}}]};
    await filterPublishedView(db, snapshot);
    globalThis.auditPinnedPublications.push(snapshot);
    refs.push(new WeakRef(store.state));
    await new Promise(resolve => setImmediate(resolve));
    global.gc();
    console.log(JSON.stringify({cycle, ...process.memoryUsage(), retainedGenerations: refs.filter(ref => ref.deref()).length}));
}
if (process.argv[2]) console.log(writeHeapSnapshot(process.argv[2]));
