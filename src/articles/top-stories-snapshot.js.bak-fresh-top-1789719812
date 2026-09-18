import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { getHeapStatistics } from 'node:v8';
import { storyText } from './story-ranking.js';
import { TOP_STORIES_DEFAULTS } from './top-stories.js';
import { storyMembers } from './story-ranking.js';

const POLICY = 1;
const valid = value => {
    if (value?.policy !== POLICY || !Array.isArray(value.articles) || !value.articles.length) return false;
    const ids = new Set(), feeds = new Map();
    for (const a of value.articles) {
        if (!a.clusterId || ids.has(a.clusterId) || !a.link || !a.title || !a.topStory?.feed || !Number.isFinite(a.ranking?.score)) return false;
        ids.add(a.clusterId);
        const feed = feeds.get(a.topStory.feed) || {rank:0, count:a.topStory.cutoff?.count};
        if (!Number.isInteger(feed.count) || feed.count < 0 || a.topStory.rank !== ++feed.rank || a.topStory.cutoff?.count !== feed.count || a.topStory.isTop !== (feed.rank <= feed.count)) return false;
        feeds.set(a.topStory.feed, feed);
    }
    return [...feeds.values()].every(feed=>feed.count<=feed.rank);
};
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
    // article.ranking already carries the public ranking result.
    'ranking'
]);

const hasPrivatePublishedState = value =>
    Boolean(
        value &&
        typeof value === 'object' &&
        [...PRIVATE_PUBLISHED_FIELDS].some(key =>
            Object.prototype.hasOwnProperty.call(value, key)
        )
    );

const compactPublishedTopStory = value => {
    if (!value || typeof value !== 'object') return value;

    const compact = { ...value };
    for (const key of PRIVATE_PUBLISHED_FIELDS) delete compact[key];
    return compact;
};

const compactPublishedArticlesInPlace = articles => {
    let changed = false;

    for (const article of articles || []) {
        if (!article?.topStory || !hasPrivatePublishedState(article.topStory)) {
            continue;
        }

        article.topStory = compactPublishedTopStory(article.topStory);
        changed = true;
    }

    return changed;
};

const extractFullStates = articles => {
    const states = {};

    for (const article of articles || []) {
        if (!article?.clusterId || !article?.topStory) continue;
        states[article.clusterId] = article.topStory;
    }

    return states;
};

const rawStateJson = async db => {
    const value = await db.get('topStoriesState');

    if (typeof value === 'string') return value || '{}';

    return JSON.stringify(value || {});
};

const rankInWorker = input => new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./top-stories-worker.js', import.meta.url), {
        workerData: input,
        resourceLimits: {
            maxOldGenerationSizeMb: Math.max(256, Math.min(1536, Number(process.env.TOP_STORIES_WORKER_HEAP_MB) || 1024))
        }
    });
    worker.once('message', result => result.error ? reject(new Error(result.error)) : resolve(result));
    worker.once('error', reject);
    worker.once('exit', code => { if (code !== 0) reject(new Error(`Ranking worker exited ${code}`)); });
});

// A display envelope around the existing index, including its editorial state.
// Publication is one durable write; no intermediate worker state is visible.
export function createTopStoriesSnapshots({ db, config, compute = rankInWorker, now = Date.now, report = console.warn } = {}) {
    let current, loading, pending, scheduled, checked, retryAt = 0;
    const load = async () => {
        if (!loading) {
            loading = db
                .get('topStoriesPublished', { type: 'json', shared: true })
                .then(async value => {
                    if (!valid(value)) return;

                    const needsMigration = (value.articles || []).some(
                        article => hasPrivatePublishedState(article?.topStory)
                    );

                    if (needsMigration) {
                        let fullStates = extractFullStates(value.articles);
                        let fullStatesJson = JSON.stringify(fullStates);
                        fullStates = null;

                        // State first. If interrupted, migration is safely
                        // repeatable from the old published snapshot.
                        await db.put('topStoriesState', fullStatesJson);
                        fullStatesJson = null;

                        compactPublishedArticlesInPlace(value.articles);

                        let publishedJson = JSON.stringify(value);
                        await db.put('topStoriesPublished', publishedJson);
                        publishedJson = null;

                        if (typeof global.gc === 'function') global.gc();
                    }

                    current = value;
                });
        }

        await loading;
        return current;
    };
    async function migrate() {
        const states = await db.get(
            'topStoriesState',
            { type: 'json', shared: true }
        );
        if (!states || !Object.keys(states).length) return;
        const [clusters, raw] = await Promise.all(['smartClusters','smartRawArticles'].map(key=>db.get(key,{type:'json',shared:true})));
        const byLink = new Map([...(clusters || []).flatMap(storyMembers), ...(raw || [])].map(a=>[a.link,a]));
        const articles = [];
        const weights = {...TOP_STORIES_DEFAULTS.weights,...config?.weights};
        for (const state of Object.values(states)) {
            // Old persistence did not include full cards. Derive only when all
            // ranked evidence is still present and byte-equivalent after normalization.
            if (
                !state.contents ||
                !state.rank ||
                !state.ranking?.signals ||
                state.relevancePolicyVersion !== 3
            ) return;
            const members = Object.keys(state.contents).map(link=>byLink.get(link));
            if (members.some(a=>!a)) return;
            for (const a of members) {
                const text = storyText(`${a.title || ''} ${a.content || a.description || ''}`).toLowerCase();
                const hash = createHash('sha256').update(JSON.stringify(text)).digest('hex').slice(0,24);
                if (hash !== state.contents[a.link]) return;
            }
            const representative = members.find(a=>a.link===state.representative);
            if (!representative) return;
            const signals=state.ranking.signals;
            const rawScore=Object.entries(weights).reduce((sum,[key,w])=>sum+w*signals[key],0)/Object.values(weights).reduce((a,b)=>a+b,0);
            const score=rawScore*Math.max(0,Math.min(1,Number(signals.relevance)||0))*(.45+.55*Math.exp(-Math.max(0,now()-state.latest_material_update)/3600000/(config?.freshnessHours || 48)));
            articles.push({...representative,clusterId:state.id,isCluster:true,relatedArticles:members.filter(a=>a!==representative),clusterCount:members.length,
                topStory:{...state,ranking:{score,signals}},ranking:{score,signals},hotness:score,imageCandidates:members.map(a=>a.image).filter(Boolean)});
        }
        articles.sort((a,b)=>a.topStory.feed.localeCompare(b.topStory.feed)||a.topStory.rank-b.topStory.rank);
        for (const feed of new Set(articles.map(a=>a.topStory.feed))) {
            const items=articles.filter(a=>a.topStory.feed===feed);
            const count=items.filter(a=>a.topStory.isTop).length;
            if (items.some((a,i)=>a.topStory.rank!==i+1 || a.topStory.isTop!==(i<count))) return;
            for (const a of items) a.topStory.cutoff={count,reason:'Preserved persisted editorial cutoff'};
        }
        compactPublishedArticlesInPlace(articles);
const migrated={policy:POLICY,articles,createdAt:now(),signature:'legacy',clusterVersion:'persisted-top'};
        if (valid(migrated)) { await db.put('topStoriesPublished',JSON.stringify(migrated)); current=migrated; }
    }
    async function rebuild() {
        const [clusterState, finalVersion, status, progressiveState] = await Promise.all([
            db.get('smartClusterState', {type:'json'}),
            db.get('smartClusterVersion'),
            db.get('smartStatus', {type:'json'}),
            db.get('smartProgressiveClusterState', {type:'json'})
        ]);
        const progressiveVersion = String(progressiveState?.version || '');
        const progressiveActive = Boolean(
            progressiveState?.active === true &&
            progressiveState?.provisional === true &&
            progressiveVersion
        );
        // During a refresh Top can rank a membership-valid progressive snapshot.
        // Without one, retain the last durable ranking instead of reading a
        // half-built cluster state.
        if (status?.state === 'refreshing' && !progressiveActive) return current;
        if (!progressiveActive && clusterState?.provisional) return current;

        const selectedVersion = progressiveActive
            ? progressiveVersion
            : (finalVersion || '');
        const progressiveRevision = progressiveActive
            ? Number(progressiveState?.revision) || 0
            : 0;

        const heapLimitBytes = Number(getHeapStatistics().heap_size_limit) || (4 * 1024 * 1024 * 1024);
        const configuredHeapMb = Number(
            progressiveActive
                ? process.env.TOP_STORIES_PROGRESSIVE_HEAP_MAX_MB
                : process.env.TOP_STORIES_MAIN_HEAP_MAX_MB
        );
        const heapMaxBytes = Number.isFinite(configuredHeapMb) && configuredHeapMb > 0
            ? configuredHeapMb * 1024 * 1024
            : Math.floor(heapLimitBytes * (progressiveActive ? 0.45 : 0.55));
        let memory = process.memoryUsage();
        if (memory.heapUsed >= heapMaxBytes && typeof global.gc === 'function') {
            global.gc();
            memory = process.memoryUsage();
        }
        if (memory.heapUsed >= heapMaxBytes) {
            retryAt = now() + 15000;
            report('[TOP STORIES] Ranking deferred under memory pressure:', JSON.stringify({
                heapUsedMB: Math.round(memory.heapUsed / 1024 / 1024),
                heapLimitMB: Math.round(heapLimitBytes / 1024 / 1024),
                thresholdMB: Math.round(heapMaxBytes / 1024 / 1024),
                progressive: progressiveActive
            }));
            return current;
        }

        let [progressivePublication, finalClusters, raw, sources] = await Promise.all([
            progressiveActive
                ? db.get('smartProgressivePublication', {type:'json',shared:true})
                : Promise.resolve(null),
            progressiveActive
                ? Promise.resolve(null)
                : db.get('smartClusters', {type:'json',shared:true}),
            db.get('smartRawArticles', {type:'json',shared:true}),
            db.get('smartSources', {type:'json',shared:true})
        ]);
        let clusters;
        if (progressiveActive) {
            if (
                progressivePublication?.version !== progressiveVersion ||
                !Array.isArray(progressivePublication?.clusters)
            ) {
                return current;
            }
            clusters = progressivePublication.clusters;
        } else {
            clusters = finalClusters || [];
        }
        progressivePublication = null;
        finalClusters = null;
        raw = raw || [];
        sources = sources || [];
        if (!clusters.length) return current;

        const rerankIntervalMs = Math.max(
            60_000,
            Math.min(
                15 * 60_000,
                Number(process.env.TOP_STORIES_RERANK_INTERVAL_MS) || 60_000
            )
        );
        const timeBucket = Math.floor(now() / rerankIntervalMs);
        const sourceFingerprint = createHash('sha256').update(JSON.stringify(
            sources.map(source => [
                source.url,
                source.category,
                source.region,
                source.weight,
                source.enabled,
                source.excludeFromSmart
            ])
        )).digest('hex').slice(0,24);
        // Cluster version/revision is the authoritative heavy-input identity.
        // Do not JSON.stringify every cluster + raw article merely to decide
        // whether ranking needs to run; that transient string caused multi-GB
        // old-space spikes after Smart publication.
        const signature = createHash('sha256').update(JSON.stringify([
            POLICY,
            config,
            selectedVersion,
            progressiveRevision,
            sourceFingerprint,
            raw.length,
            timeBucket
        ])).digest('hex');
        if (checked === signature || signature === current?.signature) {
            checked = signature;
            return current;
        }

        const represented = new Set();
        for (const cluster of clusters) {
            for (const member of storyMembers(cluster)) {
                if (member?.link) represented.add(member.link);
            }
        }
        let candidates = [...clusters];
        for (const article of raw) {
            if (article?.link && !represented.has(article.link)) {
                candidates.push(article);
            }
        }

        memory = process.memoryUsage();
        if (memory.heapUsed >= heapMaxBytes) {
            candidates.length = 0;
            represented.clear();
            retryAt = now() + 15000;
            report('[TOP STORIES] Ranking deferred after candidate assembly:', JSON.stringify({
                heapUsedMB: Math.round(memory.heapUsed / 1024 / 1024),
                thresholdMB: Math.round(heapMaxBytes / 1024 / 1024),
                progressive: progressiveActive
            }));
            return current;
        }

        // Keep the full ranking state serialized in the parent process.
        // The worker parses it in its isolated heap.
        let statesJson = await rawStateJson(db);

        const result = await compute({
            candidates,
            sources,
            statesJson,
            config,
            now: now()
        });

        // workerData has already been cloned. Drop the large input graph before
        // serializing the replacement returned by the ranking worker.
        candidates.length = 0;
        candidates = null;
        represented.clear();
        clusters = null;
        raw = null;
        sources = null;
        statesJson = null;
        if (typeof global.gc === 'function') global.gc();

        // Normal worker path: full internal state comes back as one JSON
        // string rather than another large parsed graph.
        let nextStatesJson =
            typeof result.statesJson === 'string'
                ? result.statesJson
                : null;

        // Compatibility path for custom compute implementations/tests.
        if (!nextStatesJson && Array.isArray(result.articles)) {
            let fullStates = extractFullStates(result.articles);
            nextStatesJson = JSON.stringify(fullStates);
            fullStates = null;
        }

        if (nextStatesJson) {
            await db.put('topStoriesState', nextStatesJson);
        }

        compactPublishedArticlesInPlace(result.articles);

        nextStatesJson = null;
        if (typeof global.gc === 'function') global.gc();

        const replacement = {
            policy: POLICY,
            signature,
            createdAt: now(),
            clusterVersion: selectedVersion,
            progressive: progressiveActive,
            progressiveRevision,
            articles: result.articles,
            timings: result.timings
        };
        if (!valid(replacement)) throw new Error('Incomplete or empty ranked replacement');

        let replacementJson = JSON.stringify(replacement);
        await db.put('topStoriesPublished', replacementJson);
        replacementJson = null;
        current = replacement;
        checked = signature;
        retryAt = 0;
        if (typeof global.gc === 'function') global.gc();
        return current;
    }
    function refresh() {
        if (!pending && now() >= retryAt) {
            pending = rebuild().catch(error => {
                retryAt = now() + 30000;
                report('[TOP STORIES] Keeping last valid snapshot:', error.message);
                return current;
            }).finally(() => { pending = null; });
        }
        return pending || Promise.resolve(current);
    }
    function schedule() {
        if (scheduled || pending) return;
        scheduled = setTimeout(() => { scheduled = null; void refresh(); }, 25);
        scheduled.unref?.();
    }
    return {
        async get() { await load(); if (!current) { await migrate(); if (!current) await refresh(); } return current; },
        schedule,
        async revalidate() { await load(); return refresh(); },
        get pending() { return Boolean(pending || scheduled); }
    };
}
