import {copyFile,stat,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {embeddingEntries,mergeEmbeddingCache} from '../../../src/smart/embeddings/disk-cache.js';
import {createEmbeddingCheckpoint} from '../../../src/smart/embeddings/checkpoint.js';
const source=process.argv[2]||'/home/ubuntu/my-rss-reader/smart-embeddings-worker.json',root=await mkdtemp('/tmp/rss-embedding-replay-'),results=[];
try{
 const frozen=path.join(root,'frozen.json');await copyFile(source,frozen,constants.COPYFILE_FICLONE);
 const keys=new Set();for await(const {key} of embeddingEntries(frozen)){keys.add(key);if(keys.size===500)break;}
 for(const variant of ['before','after']){
  const filename=path.join(root,variant+'.json');await copyFile(frozen,filename,constants.COPYFILE_FICLONE);const cache={};let writes=0,bytes=0;
  const checkpoint=createEmbeddingCheckpoint({filename,importEntries:x=>Object.assign(cache,x),exportEntries:()=>cache,merge:async(...args)=>{const count=await mergeEmbeddingCache(...args);writes++;bytes+=(await stat(filename)).size;return count;}});
  await checkpoint.load(keys);const start=performance.now(),cpu=process.cpuUsage();
  for(let i=0;i<3;i++)if(variant==='before'){await mergeEmbeddingCache(filename,cache);writes++;bytes+=(await stat(filename)).size;}else await checkpoint.save();
  results.push({variant,required:keys.size,writes,bytes,ms:performance.now()-start,cpu:process.cpuUsage(cpu)});
 }
 await writeFile('/tmp/rss-audit-followup-20261007/embedding-write-replay.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}finally{await rm(root,{recursive:true,force:true});}
