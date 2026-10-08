import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {embeddingEntries,loadEmbeddingSubset} from './disk-cache.js';

const FORMAT='rss-embedding-parts-v1';
const locations=filename=>{
    const directory=path.join(path.dirname(filename),'database_state','embeddings',path.basename(filename));
    return {directory,manifest:path.join(directory,'manifest.json')};
};
async function sync(filename){const handle=await fs.open(filename,'r');try{await handle.sync();}finally{await handle.close();}}
async function baseIdentity(filename){try{const s=await fs.stat(filename);return {size:s.size,mtimeMs:s.mtimeMs};}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function loadManifest(filename){
    const {manifest}=locations(filename);let value;
    try{value=JSON.parse(await fs.readFile(manifest,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}
    if(value.format!==FORMAT||!value.owners||!value.parts||Array.isArray(value.owners)||Array.isArray(value.parts))throw Error('Invalid embedding manifest');
    for(const [id,part] of Object.entries(value.parts))if(!/^[a-f0-9-]{36}$/.test(id)||part.file!==id+'.json'||!Number.isSafeInteger(part.count)||part.count<0)throw Error('Invalid embedding part');
    if(Object.values(value.owners).some(id=>id!==''&&!Object.hasOwn(value.parts,id)))throw Error('Unknown embedding part');
    if(JSON.stringify(value.base)!==JSON.stringify(await baseIdentity(filename)))throw Error('Embedding legacy base changed outside the incremental writer');
    return value;
}

// The original flat cache stays immutable. A compact key-to-part index makes
// changed checkpoints proportional to new vectors rather than all history.
export async function loadIncrementalEmbeddingSubset(filename,keys,importEntries){
    for(let attempt=0;attempt<3;attempt++) {
        const manifest=await loadManifest(filename);
        if(!manifest)return loadEmbeddingSubset(filename,keys,importEntries);
        const groups=new Map(),selected={};
        for(const key of keys)if(Object.hasOwn(manifest.owners,key)){
            const id=manifest.owners[key];if(!groups.has(id))groups.set(id,new Set());groups.get(id).add(key);
        }
        try {
            for(const [id,wanted] of groups) {
                const source=id?path.join(locations(filename).directory,manifest.parts[id].file):filename;
                for await(const {key,encodedJson} of embeddingEntries(source))if(wanted.has(key))Object.defineProperty(selected,key,{value:JSON.parse(encodedJson),enumerable:true,configurable:true});
            }
        } catch(error) {if(error.code==='ENOENT'&&attempt<2)continue;throw error;}
        const expected=[...groups.values()].reduce((sum,group)=>sum+group.size,0);
        if(Object.keys(selected).length!==expected)throw Error('Embedding part is missing indexed vectors');
        importEntries(selected);
        return {entries:Object.keys(manifest.owners).length,matched:Object.keys(selected).length};
    }
}

// The worker already serializes checkpoints. Fault hooks are for isolated
// crash-recovery tests; production passes no hook and has one writer per cache.
export async function mergeIncrementalEmbeddingCache(filename,updates,{checkpoint=async()=>{},maxParts=32}={}){
    let previous=await loadManifest(filename);
    if(!previous){
        const owners=Object.create(null);
        try{for await(const {key} of embeddingEntries(filename))owners[key]='';}catch(error){if(error.code!=='ENOENT')throw error;}
        previous={format:FORMAT,base:await baseIdentity(filename),owners,parts:{}};
    }
    if(!Object.keys(updates).length)return Object.keys(previous.owners).length;
    const {directory,manifest}=locations(filename);
    await fs.mkdir(directory,{recursive:true});
    const id=randomUUID(),part=path.join(directory,id+'.json'),temporary=manifest+'.tmp-'+id;
    const owners={...previous.owners},parts={...previous.parts};
    let committed=false;
    // Periodically compact only live delta vectors. The unchanged legacy base
    // is neither decoded nor rewritten; historical vector keys are preserved.
    async function* entries(){
        for(const [key,value] of Object.entries(updates)){
            if(typeof value!=='string')throw Error('Embedding values must be encoded strings');
            yield {key,encodedJson:JSON.stringify(value)};
        }
        if(Object.keys(parts).length>=maxParts)
            for(const [oldId,oldPart] of Object.entries(parts))for await(const entry of embeddingEntries(path.join(directory,oldPart.file)))
                if(owners[entry.key]===oldId&&!Object.hasOwn(updates,entry.key))yield entry;
    }
    try {
        let count=0,batch='{';const output=await fs.open(part,'wx');
        try {
            for await(const {key,encodedJson} of entries()){
                batch+=`${count++?',':''}${JSON.stringify(key)}:${encodedJson}`;
                Object.defineProperty(owners,key,{value:id,enumerable:true,configurable:true,writable:true});
                if(batch.length>=256*1024){await output.writeFile(batch);batch='';await checkpoint('part-writing');}
            }
            await output.writeFile(batch+'}');await output.sync();
        }finally{await output.close();}
        await sync(directory);await sync(path.dirname(directory));await sync(path.dirname(path.dirname(directory)));await sync(path.dirname(filename));
        await checkpoint('part-durable');
        parts[id]={file:id+'.json',count};
        const live=new Set(Object.values(owners));
        for(const oldId of Object.keys(parts))if(!live.has(oldId))delete parts[oldId];
        const next={format:FORMAT,base:previous.base,owners,parts};
        const handle=await fs.open(temporary,'wx');
        try{await handle.writeFile(JSON.stringify(next));await handle.sync();}finally{await handle.close();}
        await checkpoint('manifest-ready');
        await fs.rename(temporary,manifest);committed=true;
        await sync(directory);await checkpoint('manifest-durable');
        // Readers retry if they captured a prior manifest during cleanup.
        for(const name of await fs.readdir(directory))
            if((/^[a-f0-9-]{36}\.json$/.test(name)&&!parts[name.slice(0,-5)])||/^manifest\.json\.tmp-[a-f0-9-]{36}$/.test(name))await fs.unlink(path.join(directory,name)).catch(()=>{});
        return Object.keys(owners).length;
    }catch(error){
        await fs.unlink(temporary).catch(()=>{});
        if(!committed)await fs.unlink(part).catch(()=>{});
        throw error;
    }
}
