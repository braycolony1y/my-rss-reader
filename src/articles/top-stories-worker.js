// The existing deterministic index runs away from the HTTP event loop.
import { parentPort, workerData } from 'node:worker_threads';
import { createTopStoriesIndex } from './top-stories.js';

const PRIVATE_PUBLISHED_FIELDS = new Set([
    'contents',
    'materialTexts',
    'evidence',
    'links',
    'representative',
    'representativeReason',
    'rankHistory',
    'cutoffHistory',
    'history',
    // The article already carries ranking at article.ranking.
    'ranking'
]);

function compactPublishedTopStory(value) {
    if (!value || typeof value !== 'object') return value;

    const compact = { ...value };
    for (const key of PRIVATE_PUBLISHED_FIELDS) delete compact[key];
    return compact;
}

let topStoriesStateJson =
    typeof workerData.statesJson === 'string'
        ? workerData.statesJson
        : JSON.stringify(workerData.states || {});

let initialStates = {};
try {
    initialStates = JSON.parse(topStoriesStateJson || '{}');
} catch {
    initialStates = {};
    topStoriesStateJson = '{}';
}

const state = {
    topStoriesState: initialStates
};

try {
    const timings = {};

    const index = createTopStoriesIndex({
        config: workerData.config,
        db: {
            get: async key => state[key],

            put: async (key, value) => {
                // Keep the canonical ranking state serialized so it can cross
                // the worker boundary without creating another large object
                // graph in the parent process.
                if (key === 'topStoriesState') {
                    topStoriesStateJson = value;
                }

                state[key] = JSON.parse(value);
            }
        }
    });

    const articles = await index.rank(
        workerData.candidates,
        workerData.sources,
        workerData.now,
        timings
    );

    // Do not send the full internal editorial/ranking state back inside every
    // published card. The durable full state travels as one JSON string.
    for (const article of articles) {
        if (article?.topStory) {
            article.topStory = compactPublishedTopStory(article.topStory);
        }
    }

    parentPort.postMessage({
        articles,
        timings,
        statesJson: topStoriesStateJson
    });
} catch (error) {
    parentPort.postMessage({ error: error.message });
}
