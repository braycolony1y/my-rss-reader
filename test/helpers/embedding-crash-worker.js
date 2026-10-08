import {mergeIncrementalEmbeddingCache} from '../../src/smart/embeddings/incremental-cache.js';
const [file,stage]=process.argv.slice(2);
const updates={saved:'new',...Object.fromEntries(Array.from({length:100},(_,i)=>['new-'+i,'A'.repeat(4096)]))};
await mergeIncrementalEmbeddingCache(file,updates,{checkpoint:async phase=>{
    if(phase===stage){process.send(phase);await new Promise(()=>{});}
}});
