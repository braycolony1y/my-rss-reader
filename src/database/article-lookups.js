import { normalizeStateUrl } from '../utils/state-url.js';

// The fallback keeps fixture/adaptor compatibility. SQLite performs an indexed
// subset read, retaining the authoritative membership and order in each corpus.
export async function articlesByLinks(db,key,links,{normalized=false}={}) {
    const wanted=Array.from(links);
    if(db.findArticles)return db.findArticles(key,normalized?{normalizedLinks:wanted}:{links:wanted});
    const rows=await db.get(key,{type:'json',shared:true})||[];
    const set=new Set(normalized?wanted.map(normalizeStateUrl):wanted);
    return rows.filter(row=>set.has(normalized?normalizeStateUrl(row.link):row.link));
}
