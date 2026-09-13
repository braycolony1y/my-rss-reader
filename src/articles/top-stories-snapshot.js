import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
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
const rankInWorker = input => new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./top-stories-worker.js', import.meta.url), { workerData: input });
    worker.once('message', result => result.error ? reject(new Error(result.error)) : resolve(result));
    worker.once('error', reject);
    worker.once('exit', code => { if (code !== 0) reject(new Error(`Ranking worker exited ${code}`)); });
});

// A display envelope around the existing index, including its editorial state.
// Publication is one durable write; no intermediate worker state is visible.
export function createTopStoriesSnapshots({ db, config, compute = rankInWorker, now = Date.now, report = console.warn } = {}) {
    let current, loading, pending, scheduled, checked, retryAt = 0;
    const load = async () => {
        if (!loading) loading = db.get('topStoriesPublished', { type: 'json', shared: true }).then(value => { if (valid(value)) current = value; });
        await loading;
        return current;
    };
    async function migrate() {
        const states = await db.get('topStoriesState', {type:'json'});
        if (!states || !Object.keys(states).length) return;
        const [clusters, raw] = await Promise.all(['smartClusters','smartRawArticles'].map(key=>db.get(key,{type:'json',shared:true})));
        const byLink = new Map([...(clusters || []).flatMap(storyMembers), ...(raw || [])].map(a=>[a.link,a]));
        const articles = [];
        const weights = {...TOP_STORIES_DEFAULTS.weights,...config?.weights};
        for (const state of Object.values(states)) {
            // Old persistence did not include full cards. Derive only when all
            // ranked evidence is still present and byte-equivalent after normalization.
            if (!state.contents || !state.rank || !state.ranking?.signals) return;
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
            const score=(signals.relevance<1?0:rawScore)*(.45+.55*Math.exp(-Math.max(0,now()-state.latest_material_update)/3600000/(config?.freshnessHours || 48)));
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
        const migrated={policy:POLICY,articles,createdAt:now(),signature:'legacy',clusterVersion:'persisted-top'};
        if (valid(migrated)) { await db.put('topStoriesPublished',JSON.stringify(migrated)); current=migrated; }
    }
    async function rebuild() {
        const [clusters, raw, sources, clusterState, version, status] = await Promise.all([
            db.get('smartClusters', {type:'json',shared:true}), db.get('smartRawArticles', {type:'json',shared:true}),
            db.get('smartSources', {type:'json',shared:true}), db.get('smartClusterState', {type:'json'}), db.get('smartClusterVersion'), db.get('smartStatus', {type:'json'})
        ]);
        // Classic can consume provisional publications. Top never promotes them.
        if (status?.state === 'refreshing' || clusterState?.provisional || /_provisional|_early/.test(String(version))) return current;
        const minute = Math.floor(now() / 60000);
        if (checked && checked.clusters === clusters && checked.raw === raw && checked.sources === sources && checked.minute === minute) return current;
        const signature = createHash('sha256').update(JSON.stringify([POLICY, config, clusters, raw, sources, minute])).digest('hex');
        if (signature === current?.signature) { checked = {clusters, raw, sources, minute}; return current; }
        const represented = new Set((clusters || []).flatMap(a => storyMembers(a).map(m => m.link)));
        const candidates = [...(clusters || []), ...(raw || []).filter(a => !represented.has(a.link))];
        const states = current?.states || (current && Object.fromEntries(current.articles.map(a=>[a.clusterId,a.topStory]))) || await db.get('topStoriesState', {type:'json'}) || {};
        const result = await compute({ candidates, sources: sources || [], states, config, now:now() });
        const replacement = { policy:POLICY, signature, createdAt:now(), clusterVersion:version || '', articles:result.articles, timings:result.timings };
        if (!valid(replacement)) throw new Error('Incomplete or empty ranked replacement');
        // Inputs may have changed while the worker was running. Publish this
        // complete point-in-time version; the next check reconciles newer inputs.
        await db.put('topStoriesPublished', JSON.stringify(replacement));
        current = replacement;
        checked = {clusters, raw, sources, minute};
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
