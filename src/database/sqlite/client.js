import { Worker } from 'node:worker_threads';
import { createDatabaseTransactionQueue } from '../transaction-queue.js';
import { createRevisionCache } from './revision-cache.js';
import { runStorageMaintenance } from './background-maintenance.js';

export function createSqliteClient(options) {
    const cache=createRevisionCache({maxBytes:(Number(process.env.RSS_SQLITE_CACHE_MB)||48)*1024*1024});
    const queue=createDatabaseTransactionQueue();
    let worker,ready,sequence=0,failure,closed=false,closeAcknowledged=false,onFatal;
    const pending=new Map();
    let upgrade,closing=false;
    const maintenanceAbort=new AbortController(),maintenanceTasks=new Set();
    function maintenanceRequest(action,settings={}){
        if(closing)return Promise.reject(Error('SQLite storage closing'));
        const task=runStorageMaintenance(options,action,settings,maintenanceAbort.signal);
        maintenanceTasks.add(task);
        task.then(()=>maintenanceTasks.delete(task),()=>maintenanceTasks.delete(task));
        return task;
    }
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
    function decoded(result){const value=rawValue(result);return typeof value==='string' && result?.info?.encoding!=='native'?JSON.parse(value):value;}
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
    async function readMany(keys,{shared=false}={}) {
        return queue.run(async()=>{
            const held=Object.fromEntries(keys.map(key=>[key,cache.peek(key)]));
            const revisions=Object.fromEntries(keys.filter(key=>held[key]).map(key=>[key,held[key].revision]));
            const results=await request('getMany',{keys,revisions});
            return Object.fromEntries(keys.map(key=>{
                // Same contract as get(key,{type:'json'}): absent or empty is null.
                const result=results[key];if(!result?.info||(!result.cached&&!rawValue(result)))return [key,null];
                let value;
                if(result.cached)value=held[key].value;
                else{
                    value=decoded(result);
                    if(value && typeof value==='object')cache.set(key,result.info.revision,value,
                        (typeof result.value==='string'?Buffer.byteLength(result.value):JSON.stringify(value).length)*2);
                }
                return [key,shared?value:structuredClone(value)];
            }));
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
    // Maintenance writes through a second connection (WAL: one writer, many
    // readers). While it runs, new writes wait here, before entering the FIFO
    // queue, so no save races that writer's lock/busy_timeout; reads keep
    // flowing through the queue against their WAL snapshot.
    let writeGate=null;
    const gated=operation=>(...args)=>{
        if(!writeGate)return operation(...args);
        return (async()=>{while(writeGate)await writeGate;return operation(...args);})();
    };
    async function withWritesHeld(operation){
        while(writeGate)await writeGate;
        let release;writeGate=new Promise(resolve=>{release=resolve;});
        try{
            // Barrier: every write already queued (and its transaction) finishes.
            await queue.run(()=>undefined);
            return await operation();
        }finally{writeGate=null;release();}
    }
    const api={
        get:read,
        getMany:readMany,
        put:gated((key,value,opts={})=>mutate([key],()=>({[key]:value}),opts,false)),
        putMany:gated((changes,opts={})=>mutate(Object.keys(changes),()=>changes,opts,false)),
        updateMany:gated(mutate),
        findArticles:(key,query={})=>queue.run(()=>request('findArticles',{key,options:query})),
        getEntries:(key,ids)=>queue.run(()=>request('getEntries',{key,ids})),
        patchEntries:gated((key,values,remove=[])=>queue.run(async()=>{const result=await request('patchEntries',{key,values,remove});if(result.changed)cache.invalidate(key);return result;})),
        keys:()=>queue.run(()=>request('keys')),
        async backup(opts={}){await start();return maintenanceRequest('backup',opts);},
        // compact=false stops after the row phase; the VACUUM phase (which
        // holds writes for up to about a minute on a 1 GB file) runs later.
        async optimizeStorage({compact=true}={}){
            return upgrade ||= (async()=>{
                await start();
                const progress=await maintenanceRequest('prepareUpgrade');
                if(progress.complete||closing)return progress;
                // Drain outstanding writes and hold new ones until the rewrite/
                // VACUUM finishes. No save races the second writer's
                // busy_timeout and no uncertain mutation is replayed.
                // Two short holds (rows, then VACUUM) instead of one long one.
                const rows=await withWritesHeld(()=>closing?{deferred:true}:maintenanceRequest('upgrade',{phase:'rows'}));
                if(rows.complete||rows.deferred||closing||!compact)return rows;
                const done=await withWritesHeld(()=>closing?{deferred:true}:maintenanceRequest('upgrade',{phase:'compact'}));
                // Integrity after VACUUM, read-only and outside the hold.
                if(done.complete&&!closing)done.integrity=(await maintenanceRequest('check')).integrity;
                return done;
            })().finally(()=>{upgrade=null;});
        },
        async check(){await start();return maintenanceRequest('check');},
        // Backup (with a full integrity_check of its snapshot) first, unheld.
        // A failed backup never skips pruning; its error is reported after.
        async maintenance(){
            await start();
            let backup,backupError;
            try{backup=await maintenanceRequest('backup');}catch(error){backupError=error;}
            const result=await withWritesHeld(()=>closing?{deferred:true}:maintenanceRequest('maintenance'));
            if(backupError)throw Object.assign(backupError,{maintenance:result});
            // integrity: the backup's full integrity_check of the same database.
            return {...result,integrity:'ok',backup};
        },
        cacheGet:path=>queue.run(()=>request('cacheGet',{path})),
        cacheInfo:path=>queue.run(()=>request('cacheInfo',{path})),
        cacheList:prefix=>queue.run(()=>request('cacheList',{prefix})),
        cachePut:gated((path,json)=>queue.run(()=>request('cachePut',{path,json}))),
        cacheRemove:gated(path=>queue.run(()=>request('cacheRemove',{path}))),
        async close(){if(closed)return;closing=true;maintenanceAbort.abort(Error('SQLite storage closing'));await Promise.allSettled([...maintenanceTasks]);
            // Writes released by an aborted maintenance enqueue before close.
            while(writeGate)await writeGate;
            try{if(ready&&!failure)await queue.run(()=>request('close'));}finally{closed=true;cache.clear();if(worker)await worker.terminate();}},
    };
    return {api,initialize:start,onFatal:handler=>{onFatal=handler;},releaseParsedCache:()=>cache.clear(),
        resourceState:()=>({...cache.state(),...statistics,persistentValues:{entries:statistics.collections||0,bufferedEntries:0,utf8Bytes:0,unbufferedStringChars:0},transactions:queue.state()})};
}
