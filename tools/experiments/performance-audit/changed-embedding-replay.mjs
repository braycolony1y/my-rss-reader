import fs from 'node:fs/promises';
import path from 'node:path';
import {mergeEmbeddingCache} from '../../../src/smart/embeddings/disk-cache.js';
import {mergeIncrementalEmbeddingCache,loadIncrementalEmbeddingSubset} from '../../../src/smart/embeddings/incremental-cache.js';
const output=process.argv[2],root=await fs.mkdtemp('/tmp/rss-changed-vectors-');
const count=80000,vector='A'.repeat(4096),source=path.join(root,'source.json');
const handle=await fs.open(source,'w');
await handle.writeFile('{');
for(let i=0;i<count;i+=1000)await handle.writeFile(Array.from({length:Math.min(1000,count-i)},(_,j)=>`${i+j?',':''}"model:${i+j}":"${vector}"`).join(''));
await handle.writeFile('}');await handle.sync();await handle.close();
const io=async()=>Number((await fs.readFile('/proc/self/io','utf8')).match(/^write_bytes: (\d+)/m)[1]);
const rows=[];
try {
    for(const variant of ['before','after']) {
        const directory=path.join(root,variant);await fs.mkdir(directory);const file=path.join(directory,'vectors.json');await fs.copyFile(source,file);
        const merge=variant==='before'?mergeEmbeddingCache:mergeIncrementalEmbeddingCache,samples=[];
        const begin=await io();
        for(let cycle=0;cycle<5;cycle++){
            const updates=Object.fromEntries(Array.from({length:200},(_,i)=>['model:'+i,Buffer.from(`cycle:${cycle}`).toString('base64')+vector]));
            const start=performance.now(),bytes=await io(),entries=await merge(file,updates);
            if(entries!==count)throw Error('Vector history lost');
            samples.push({cycle,ms:performance.now()-start,physicalBytes:(await io())-bytes});
        }
        if(variant==='after'){
            const restored={};await loadIncrementalEmbeddingSubset(file,new Set(['model:0','model:79999']),values=>Object.assign(restored,values));
            if(restored['model:0']!==Buffer.from('cycle:4').toString('base64')+vector||restored['model:79999']!==vector)throw Error('Vector recovery mismatch');
        }
        rows.push({variant,sourceBytes:(await fs.stat(source)).size,physicalBytes:(await io())-begin,samples});
        await fs.writeFile(output,JSON.stringify(rows,null,2));console.log(JSON.stringify(rows.at(-1)));
    }
}finally{await fs.rm(root,{recursive:true,force:true});}
