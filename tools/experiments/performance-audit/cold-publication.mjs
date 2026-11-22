// Run only against a disposable copy, never against the live writer directory.
import { createDatabaseStore } from '../../../src/database/store.js';
import { createTopStoriesSnapshots } from '../../../src/articles/top-stories-snapshot.js';
import { getPersonalStore } from '../../../src/smart/feedback/store.js';
import { getPrefilterStore } from '../../../src/smart/prefilter/state.js';
import { writeHeapSnapshot } from 'node:v8';
if (!process.argv[2]?.startsWith('/tmp/')) throw Error('A disposable /tmp state copy is required');
process.chdir(process.argv[2]);
const store = createDatabaseStore();
const db = store.env.RSS_DATA;
const get = db.get;
db.get = async (...args) => {
    const start = performance.now();
    const value = await get(...args);
    console.log(JSON.stringify({key:args[0],ms:performance.now()-start}));
    return value;
};
const snapshots = createTopStoriesSnapshots({db});
globalThis.auditOwners = {store, snapshots};
await store.initializeWriterLock(false);
for (let cycle = 0; cycle < 5; cycle++) {
    const start = performance.now();
    const publicationStart = performance.now();
    const snapshot = await snapshots.get(process.env.AUDIT_DESTINATION || undefined);
    console.log(JSON.stringify({cycle,stage:'publication',ms:performance.now()-publicationStart,cards:snapshot?.articles?.length}));
    await getPersonalStore(db); await getPrefilterStore(db);
    for (const key of ['articles','smartClusters','smartRawArticles','cacheIdentityLedger']) await db.get(key,{type:'json',shared:true});
    await new Promise(resolve=>setImmediate(resolve)); global.gc();
    console.log(JSON.stringify({cycle,ms:performance.now()-start,...process.memoryUsage(),cache:store.getResourceState()}));
}
if (process.argv[3]) console.log(writeHeapSnapshot(process.argv[3]));
snapshots.dispose();
