import { workerPrefilterValues } from '../smart/prefilter/publication.js';
// The existing deterministic index runs away from the HTTP event loop.
import { parentPort, workerData } from 'node:worker_threads';
import { createTopStoriesIndex } from './top-stories.js';
import { storyMembers } from './story-ranking.js';

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

async function rank(workerData) {
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
    ...workerPrefilterValues(workerData.prefilterState),
    topStoriesState: initialStates
};

try {
    let candidates = workerData.candidates;
    if (typeof workerData.publicationJson === 'string') {
        const publication = JSON.parse(workerData.publicationJson);
        if (workerData.progressiveVersion && (
            publication?.version !== workerData.progressiveVersion ||
            Number(publication?.revision || 0) !== workerData.progressiveRevision ||
            !Array.isArray(publication?.clusters)
        )) {
            return {skipped:true};
        }
        candidates = workerData.progressiveVersion ? publication.clusters : (publication || []);
        const represented = new Set();
        for (const cluster of candidates) {
            for (const member of storyMembers(cluster)) if (member?.link) represented.add(member.link);
        }
        for (const article of JSON.parse(workerData.rawJson || '[]')) {
            if (article?.link && !represented.has(article.link)) {
                candidates.push(article);
                represented.add(article.link);
            }
        }
        workerData.publicationJson = null;
        workerData.rawJson = null;
    }
    if (!candidates?.length) {
        return {skipped:true};
    }
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

                if (key !== 'topStoriesState') state[key] = JSON.parse(value);
            }
        }
    });

    const articles = await index.rank(
        candidates,
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

    return {
        articles,
        timings,
        statesJson: topStoriesStateJson
    };
} catch (error) {
    return {error:error.message};
}

}
// Legacy one-shot invocation remains available for offline diagnostics.
if(workerData){parentPort.postMessage(await rank(workerData));parentPort.close();}
else{
    let queue=Promise.resolve();
    parentPort.on('message',({id,input})=>{
        queue=queue.then(async()=>parentPort.postMessage({id,result:await rank(input)}));
    });
}
