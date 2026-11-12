import fs from 'node:fs/promises';
import path from 'node:path';
import { createRepository } from './repository.js';
import { syncDirectory } from './files.js';
import { createCacheFiles } from './cache-files.js';

const SMART_KEYS=new Set(['smartTopPrefilterState','smartClusters','smartRawArticles','smartCandidateLinks','smartCandidateSignature',
    'smartAiConfig','smartClusterVersion','smartStatus','smartEmbeddingIdentity','smartVerificationFailures','smartClusteringInputs',
    'smartClusteringFailedAttempt','smartClusteringAlgorithmVersion','smartClusterState','smartEventVerificationCache',
    'smartEditorialAssessmentCache','smartClusteringCounters','smartDeferredReviewGroups','smartProgressivePublication',
    'smartProgressiveClusterState','storyBriefings','topStoriesPublished']);

// Export committed current state, never the stale pre-cutover JSON. This is
// offline tooling; only one decoded key is materialized at a time.
export async function exportLegacyDatabase(db,directory) {
    await fs.mkdir(directory,{recursive:true,mode:0o700});
    const existing=await fs.readdir(directory);if(existing.length)throw Error('Legacy export destination must be empty');
    const repository=createRepository(db),manifest=[];
    for(const [name,smart]of [['database.json',false],['smart-data.json',true]]){
        const file=await fs.open(path.join(directory,name),'wx',0o600);
        let first=true;
        try{
            await file.writeFile('{');
            for(const key of repository.keys()){
                if(SMART_KEYS.has(key)!==smart)continue;
                const info=repository.info(key),value=repository.read(key);
                await file.writeFile((first?'':',')+JSON.stringify(key)+':');first=false;
                if(typeof value==='string'){
                    await file.writeFile('"');
                    // Keep surrogate pairs together when escaping streamed text.
                    for(let offset=0;offset<value.length;){let end=Math.min(value.length,offset+65536);
                        if(end<value.length&&/[\uD800-\uDBFF]/.test(value[end-1]))end--;
                        await file.writeFile(JSON.stringify(value.slice(offset,end)).slice(1,-1));offset=end;}
                    await file.writeFile('"');
                }else await file.writeFile(JSON.stringify(value));
                manifest.push({key,encoding:info.encoding,shape:info.shape,digest:info.digest,count:info.item_count});
            }
            await file.writeFile('}');await file.sync();
        }finally{await file.close();}
    }
    const cache=createCacheFiles(db);
    for(const row of db.prepare('SELECT path FROM cache_files WHERE deleted=0').iterate()){
        if(!/^article_cache\/(?:[^/.][^/]*\.json|threads\/[a-f0-9]{64}\.json|pdf\/[a-f0-9]{64}\/job\.json)$/.test(row.path))throw Error('Invalid cache export path');
        const target=path.join(directory,row.path);await fs.mkdir(path.dirname(target),{recursive:true,mode:0o700});
        await fs.writeFile(target,cache.get(row.path).json,{mode:0o600});
    }
    await syncDirectory(directory);return manifest;
}
