import { smartEditorialCacheKey, smartEditorialEligibleDestinations } from '../../ai/smart-editorial.js';

export async function loadEditorialCache(db,clusters,sources){
    if(db.getEntries){
        const keys=clusters.map(cluster=>smartEditorialCacheKey(cluster,smartEditorialEligibleDestinations(cluster,sources)));
        return db.getEntries('smartEditorialAssessmentCache',keys);
    }
    try{return JSON.parse(await db.get('smartEditorialAssessmentCache')||'{}');}catch{return {};}
}
export async function saveEditorialCache(db,cache,original){
    if(!db.patchEntries)return db.put('smartEditorialAssessmentCache',JSON.stringify(cache));
    const changed=Object.fromEntries(Object.entries(cache).filter(([key,value])=>original[key]!==value));
    const removed=Object.keys(original).filter(key=>!Object.hasOwn(cache,key));
    if(Object.keys(changed).length||removed.length)await db.patchEntries('smartEditorialAssessmentCache',changed,removed);
}
