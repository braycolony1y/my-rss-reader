import { articlesByLinks } from '../../database/article-lookups.js';

export async function feedbackSnapshotRows(db,key,link) {
    if(key!=='topStoriesPublished')return articlesByLinks(db,key,[link]);
    let snapshot=await db.get(key,{type:'json',shared:true});
    if(typeof snapshot==='string'){try{snapshot=JSON.parse(snapshot);}catch{return [];}}
    return (Array.isArray(snapshot)?snapshot:snapshot?.articles||[]).filter(article=>article.link===link);
}
