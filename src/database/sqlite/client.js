import { Worker } from 'node:worker_threads';
import { createDatabaseTransactionQueue } from '../transaction-queue.js';
import { createRevisionCache } from './revision-cache.js';
import { runStorageMaintenance } from './background-maintenance.js';

export function createSqliteClient(options) {
    const cache=createRevisionCache({maxBytes:(Number(process.env.RSS_SQLITE_CACHE_MB)||48)*1024*1024});
    const queue=createDatabaseTransactionQueue();
    let worker,ready,sequence=0,failure,closed=false,closeAcknowledged=false,onFatal;
    const pending=new Map();
    let statistics={storage:'sqlite',writes:0,unchanged:0};
    function fail(error){const first=!failure;failure=error;cache.clear();for(const callback of pending.values())callback.reject(error);pending.clear();if(first)onFatal?.(error);}
    function start(){
        if(ready)return ready;
        ready=new Promise((resolve,reject)=>{
            const environment={...process.env};delete environment.NODE_TEST_CONTEXT;
            worker=new Worker(new URL('./worker.js',import.meta.url),{workerData:options,env:environment,
                execArgv:[],resourceLimits:{maxOldGenerationSizeMb:384}});
            worker.on('message',message=>{
                if(message.ready){if(!pending.size)worker.unref();resolve();return;}
                if(message.fatal){const error=Object.assign(Error(message.fatal.message),message.fatal);fail(error);reject(error);return;}
                const callback=pending.get(message.id);if(!callback)return;
                if(callback.action==='close'&&!message.error)closeAcknowledged=true;
                pending.delete(message.id);if(!pending.size)worker.unref();
                if(message.error)callback.reject(Object.assign(Error(message.error.message),message.error));else callback.resolve(message.result);
            });
            worker.on('error',error=>{fail(error);reject(error);});
            worker.on('exit',code=>{if(pending.size||(!closed&&!closeAcknowledged)){const error=Error(`SQLite worker exited (${code}); a pending commit may be uncertain. It was not replayed.`);error.code='SQLITE_WORKER_EXIT';fail(error);reject(error);}});
        });return ready;
    }
    async function request(action,args={}) {
        if(failure)throw failure;if(closed)throw Error('SQLite storage closed');await start();if(failure)throw failure;
        return new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject,action});worker.ref();worker.postMessage({id,action,args});});
    }
    const rawValue=result=>result?.value ?? null;
    function decoded(result){const value=rawValue(result);return typeof value==='string'?JSON.parse(value):value;}
    async function read(key,opts={}) {
        return queue.run(async()=>{
            const info=await request('info',{key});if(!info)return null;
            if(opts.fingerprint)return Object.freeze({digest:info.digest,
                readAsync:async()=>rawValue(await queue.run(()=>request('get',{key,revision:info.revision}))),
                read(){throw Error('SQLite fingerprint materialization must be awaited');}});
            if(opts.type==='json'){
                const cached=cache.get(key,info.revision);
                if(cached!==undefined)return opts.shared?cached:structuredClone(cached);
            }
            const result=await request('get',{key}),raw=rawValue(result);
            if(!raw)return null;
            if(opts.type!=='json')return raw;
            const value=decoded(result);
            if(opts.shared)cache.set(key,result.info.revision,value,(typeof raw==='string'?Buffer.byteLength(raw):JSON.stringify(raw).length)*2);
            return value;
        });
    }
    async function mutate(keys,updater,writeOptions={},readCurrent=true) {
        return queue.run(async()=>{
            const transaction=await request('begin',{keys:readCurrent?keys:[],projections:writeOptions.readProjections});
            try{
                const current=readCurrent?Object.fromEntries(keys.map(key=>[key,decoded(transaction.values[key])])):{};
                const changes=updater(current)||{};
                if(changes?.then){Promise.resolve(changes).catch(()=>{});throw TypeError('Database updater must be synchronous');}
                for(const key of Object.keys(changes))if(!keys.includes(key))throw Error(`Database updater wrote undeclared key: ${key}`);
                for(const key of Object.keys(changes))if(writeOptions.readProjections?.[key])throw Error(`Cannot replace projected collection: ${key}`);
                const result=await request('commit',{token:transaction.token,changes,options:writeOptions});
                for(const key of result.changed)cache.invalidate(key);
                statistics={...statistics,...await request('stats')};
                return result;
            }catch(error){await request('rollback',{token:transaction.token}).catch(()=>{});throw error;}
        },{keys});
    }
    const api={
        get:read,
        put:(key,value,opts={})=>mutate([key],()=>({[key]:value}),opts,false),
        putMany:(changes,opts={})=>mutate(Object.keys(changes),()=>changes,opts,false),
        updateMany:mutate,
        findArticles:(key,query={})=>queue.run(()=>request('findArticles',{key,options:query})),
        getEntries:(key,ids)=>queue.run(()=>request('getEntries',{key,ids})),
        patchEntries:(key,values,remove=[])=>queue.run(async()=>{const result=await request('patchEntries',{key,values,remove});if(result.changed)cache.invalidate(key);return result;}),
        keys:()=>queue.run(()=>request('keys')),
        async backup(opts={}){await start();return runStorageMaintenance(options,'backup',opts);},
        async maintenance(){await start();return runStorageMaintenance(options,'maintenance');},
        cacheGet:path=>queue.run(()=>request('cacheGet',{path})),
        cacheInfo:path=>queue.run(()=>request('cacheInfo',{path})),
        cacheList:prefix=>queue.run(()=>request('cacheList',{prefix})),
        cachePut:(path,json)=>queue.run(()=>request('cachePut',{path,json})),
        cacheRemove:path=>queue.run(()=>request('cacheRemove',{path})),
        async close(){if(closed)return;try{if(ready&&!failure)await queue.run(()=>request('close'));}finally{closed=true;cache.clear();if(worker)await worker.terminate();}},
    };
    return {api,initialize:start,onFatal:handler=>{onFatal=handler;},releaseParsedCache:()=>cache.clear(),
        resourceState:()=>({...cache.state(),...statistics,persistentValues:{entries:statistics.collections||0,bufferedEntries:0,utf8Bytes:0,unbufferedStringChars:0},transactions:queue.state()})};
}
