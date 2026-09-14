// The existing deterministic index runs away from the HTTP event loop.
import { parentPort, workerData } from 'node:worker_threads';
import { createTopStoriesIndex } from './top-stories.js';
const state = { topStoriesState: workerData.states || {} };
try {
    const timings = {};
    const index = createTopStoriesIndex({ config: workerData.config, db: {
        get: async key => state[key], put: async (key, value) => { state[key] = JSON.parse(value); }
    } });
    const articles = await index.rank(workerData.candidates, workerData.sources, workerData.now, timings);
    // The ranked cards already contain the persisted editorial state. Returning
    // state.topStoriesState as a second large object duplicates it across the
    // worker boundary and can briefly double ranking memory.
    parentPort.postMessage({ articles, timings });
} catch (error) { parentPort.postMessage({ error: error.message }); }
