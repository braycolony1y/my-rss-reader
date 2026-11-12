import path from 'node:path';
export async function loadSqliteArticleIndex(db){
    const rows=await db.cacheList('article_cache/');
    return new Map(rows.filter(row=>!row.deleted&&!row.path.slice('article_cache/'.length).includes('/')).map(row=>[path.basename(row.path),{
        version:row.version||0,cachedAt:row.cached_at||0,url:row.url||null,sourceDeleted:Boolean(row.source_deleted),deletedDetectedAt:row.deleted_detected_at||null
    }]));
}
