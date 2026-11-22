// Keys written only by the removed AI Smart/Top pipeline. Shared by archive-ai-data.mjs,
// delete-ai-data.mjs and restore-ai-data.mjs so the three always agree.
//
// NOT listed on purpose (still read or written by the Stories/Classic path):
//   smartAiConfig, smartDeferredReviewGroups  cluster-reuse signature and story relationships
//   smartTopPrefilterState                    deterministic regex prefilter decisions
//   lastSourceEvalTime, smartSourceScores     monthly source evaluation
//   smart-embeddings-worker.json, database_state/embeddings/  clustering and ranker vectors
import fs from 'node:fs';
import path from 'node:path';

// Whole collections (a child collection such as $topStoriesPublished.articles is part of its parent).
export const AI_COLLECTIONS = Object.freeze([
    'topStoriesState', 'topStoriesPublished', 'storyBriefings',
    'smartEditorialAssessmentCache', 'smartEventVerificationCache', 'smartVerificationFailures',
    'smartAiProviderHealth', 'smartPersonalFilters',
    'smartProgressivePublication', 'smartProgressiveClusterState',
]);
// Single entries inside the userPreferences object.
export const AI_PREFERENCES = Object.freeze(['smartTabModes', 'clusteringModel']);
// Pre-cutover keyed-overlay part files that hold only AI keys (<revision>.<key>.json).
export const LEGACY_OVERLAY_DIRS = Object.freeze(['database_state/smart-state.json', 'database_state/database-state.json']);

export const ARCHIVE_ROOT = 'database_state/archive';
export const ARCHIVE_PREFIX = 'ai-removed-';
export const MIN_ARCHIVE_AGE_DAYS = 7;

export function parseArgs(argv) {
    const flags = new Set(), values = new Map();
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg.startsWith('--')) throw Error(`Unexpected argument: ${arg}`);
        const [name, inline] = arg.slice(2).split('=');
        if (inline !== undefined) values.set(name, inline);
        else if (argv[i + 1] && !argv[i + 1].startsWith('--') && ['root', 'archive'].includes(name)) values.set(name, argv[++i]);
        else flags.add(name);
    }
    return { flags, values };
}

export function legacyAiPartFiles(root) {
    const keys = new Set(AI_COLLECTIONS), found = [];
    for (const directory of LEGACY_OVERLAY_DIRS) {
        const full = path.join(root, directory);
        let names = [];
        try { names = fs.readdirSync(full); } catch { continue; }
        for (const name of names) {
            const match = /^\d+\.(\w+)\.json$/.exec(name);
            if (match && keys.has(match[1])) found.push({ key: match[1], file: path.join(directory, name) });
        }
    }
    return found;
}
