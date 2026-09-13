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
    parentPort.postMessage({ articles, states: state.topStoriesState, timings });
} catch (error) { parentPort.postMessage({ error: error.message }); }
