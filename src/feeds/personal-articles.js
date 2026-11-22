import { articlesByLinks } from '../database/article-lookups.js';
import { cleanStoredCluster } from '../../smart-news.js';
import { normalizeStateUrl } from '../utils/state-url.js';

// normalizeStateUrl over the whole corpus costs ~60 ms per pass. The visible
// snapshot array is replaced (never mutated) on change, so index it once.
const normalizedIndexes = new WeakMap();
function normalizedIndex(articles) {
    let index = normalizedIndexes.get(articles);
    if (!index) {
        index = new Map();
        articles.forEach((article, position) => {
            const entry = { article, position };
            const link = normalizeStateUrl(article.link);
            const original = normalizeStateUrl(article.originalLink);
            for (const key of original && original !== link ? [link, original] : [link]) {
                if (index.has(key)) index.get(key).push(entry); else index.set(key, [entry]);
            }
        });
        normalizedIndexes.set(articles, index);
    }
    return index;
}

// Only articles whose normalized link is wanted can survive the caller's
// membership filter, so select them by index instead of scanning the corpus.
// Original relative order is preserved. Board needs the full map for cache members.
function wantedBase(articles, wanted) {
    const index = normalizedIndex(articles), picked = new Set();
    for (const key of wanted) for (const entry of index.get(key) || []) picked.add(entry);
    return [...picked].sort((a, b) => a.position - b.position).map(entry => entry.article);
}

export async function hydratePersonalArticles({db,articles,wanted,filterType,articleIsBlocked}) {
    const [clusters,raw]=await Promise.all(['smartClusters','smartRawArticles'].map(key=>articlesByLinks(db,key,wanted,{normalized:true,includeOriginalLink:true})));
    const smartArticles=clusters.map(cleanStoredCluster).filter(article=>article&&!articleIsBlocked(article));
    const base=filterType==='board'||!Array.isArray(articles)?articles:wantedBase(articles,wanted);
    const linkMap=new Map(base.map(article=>[article.link,article]));
    for(const article of raw)if(!articleIsBlocked(article))linkMap.set(article.link,article);
    for(const article of smartArticles)linkMap.set(article.link,article);
    if(filterType==='board'){
        const members=await db.get('cacheMembers',{type:'json'})||{};
        const byOriginal = new Map();
        for (const article of linkMap.values()) {
            if (article.originalLink && article.originalLink !== article.link) byOriginal.set(normalizeStateUrl(article.originalLink), article);
        }
        for (const member of Object.values(members)) {
            if (!member.in_cache) continue;
            const repaired = byOriginal.get(normalizeStateUrl(member.url));
            const link = repaired?.link || member.url;
            linkMap.set(link, {
                ...(linkMap.get(link) || member.article), link,
                active_caching: member.active_caching, auto_added: member.auto_added
            });
        }
    }
    return Array.from(linkMap.values());
}
