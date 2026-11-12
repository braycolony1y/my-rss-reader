import { articlesByLinks } from '../database/article-lookups.js';
import { cleanStoredCluster } from '../../smart-news.js';

export async function hydratePersonalArticles({db,articles,wanted,filterType,articleIsBlocked}) {
    const [clusters,raw]=await Promise.all(['smartClusters','smartRawArticles'].map(key=>articlesByLinks(db,key,wanted,{normalized:true})));
    const smartArticles=clusters.map(cleanStoredCluster).filter(article=>article&&!articleIsBlocked(article));
    const linkMap=new Map(articles.map(article=>[article.link,article]));
    for(const article of raw)if(!articleIsBlocked(article))linkMap.set(article.link,article);
    for(const article of smartArticles)linkMap.set(article.link,article);
    if(filterType==='board'){
        const members=await db.get('cacheMembers',{type:'json'})||{};
        for(const member of Object.values(members))if(member.in_cache)linkMap.set(member.url,{
            ...(linkMap.get(member.url)||member.article),link:member.url,active_caching:member.active_caching,auto_added:member.auto_added
        });
    }
    return Array.from(linkMap.values());
}
