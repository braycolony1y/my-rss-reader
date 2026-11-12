import { parentPort, workerData } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { ensureSqlite } from './migration.js';
import { createRepository } from './repository.js';
import { backupDatabase, maintainDatabase } from './maintenance.js';
import { createCacheFiles } from './cache-files.js';

let db,repository,transaction,timer,cacheFiles;
const rollback=()=>{if(db?.isTransaction)db.exec('ROLLBACK');transaction=null;clearTimeout(timer);};
const descriptor=key=>repository.info(key)||null;
function readSnapshot(operation){
    const own=!db.isTransaction;if(own)db.exec('BEGIN');
    try{
        const result=operation();if(own)db.exec('COMMIT');return result;
    }catch(error){if(own&&db.isTransaction)db.exec('ROLLBACK');throw error;}
}
function get(key,revision){
    return readSnapshot(()=>{
        const info=descriptor(key);
        if(revision!=null&&info?.revision!==revision){const error=Error('Ranking input changed before materialization');error.code='SQLITE_SNAPSHOT_CHANGED';throw error;}
        return {info,value:repository.read(key)};
    });
}
async function dispatch(action,args) {
    if(transaction && !['commit','rollback'].includes(action))throw Error('SQLite transaction in progress');
    if(action==='info')return descriptor(args.key);
    if(action==='get')return get(args.key,args.revision);
    if(action==='begin'){
        db.exec('BEGIN IMMEDIATE');transaction=randomUUID();
        timer=setTimeout(()=>rollback(),30000);timer.unref();
        try{return {token:transaction,values:Object.fromEntries(args.keys.map(key=>[key,args.projections?.[key]==='links'?{info:descriptor(key),value:repository.linkProjection(key)}:get(key)]))};}
        catch(error){rollback();throw error;}
    }
    if(action==='rollback'){if(args.token===transaction)rollback();return;}
    if(action==='commit'){
        if(args.token!==transaction)throw Error('Expired SQLite transaction token');
        try{
            const changed=[];
            for(const [key,value]of Object.entries(args.changes))if(repository.write(key,value,args.options))changed.push(key);
            db.exec('COMMIT');transaction=null;clearTimeout(timer);return {changed};
        }catch(error){rollback();throw error;}
    }
    if(action==='findArticles')return readSnapshot(()=>repository.findArticles(args.key,args.options));
    if(action==='getEntries')return readSnapshot(()=>repository.mapEntries(args.key,args.ids));
    if(action==='patchEntries'){
        db.exec('BEGIN IMMEDIATE');
        try{const changed=repository.patchMap(args.key,args.values,args.remove);db.exec('COMMIT');return {changed};}
        catch(error){db.exec('ROLLBACK');throw error;}
    }
    if(action==='keys')return repository.keys();
    if(action==='cacheGet')return readSnapshot(()=>cacheFiles.get(args.path));
    if(action==='cacheInfo')return cacheFiles.info(args.path);
    if(action==='cacheList')return cacheFiles.list(args.prefix);
    if(action==='cachePut')return cacheFiles.put(args.path,args.json);
    if(action==='cacheRemove')return cacheFiles.remove(args.path);
    if(action==='stats')return {storage:'sqlite',...repository.stats(),collections:db.prepare('SELECT count(*) n FROM collections').get().n};
    if(action==='backup')return backupDatabase(db,workerData.root,args);
    if(action==='maintenance')return maintainDatabase(db);
    if(action==='close'){rollback();db.exec('PRAGMA wal_checkpoint(PASSIVE)');db.close();return;}
    throw Error('Unknown SQLite action');
}

try{
    db=await ensureSqlite(workerData);repository=createRepository(db);cacheFiles=createCacheFiles(db);
    // Startup never advertises readiness until a verified restorable backup exists.
    if(workerData.backupOnOpen)await backupDatabase(db,workerData.root);
    parentPort.postMessage({ready:true});
    let queue=Promise.resolve();
    parentPort.on('message',message=>{
        queue=queue.then(async()=>{
            try{const result=await dispatch(message.action,message.args||{});parentPort.postMessage({id:message.id,result});if(message.action==='close')parentPort.close();}
            catch(error){parentPort.postMessage({id:message.id,error:{message:error.message,code:error.code,stack:error.stack}});}
        });
    });
    parentPort.on('close',()=>{try{rollback();db.close();}catch{}});
}catch(error){parentPort.postMessage({fatal:{message:error.message,code:error.code,stack:error.stack}});parentPort.close();}
