import path from 'node:path';
import fs from 'node:fs/promises';
import { readFileSync, unlinkSync } from 'node:fs';
import { createSqliteClient } from './client.js';
import { atomicJson } from './files.js';
import { writeCacheJson } from '../cache-filesystem.js';
import { hasRecentBackup, latestBackupAt } from './backup-selection.js';

export function createSqliteDatabaseStore({root=process.cwd(),filename,backupOnOpen=false}={}) {
    root=path.resolve(root);
    const client=createSqliteClient({root,filename:filename||path.join(root,'database_state','reader.sqlite'),backupOnOpen});
    const lockFile=path.join(root,'database.writer.lock');let lockHandle,maintenanceTimer,compactionTimer;
    // The one-time VACUUM holds new writes (reads continue) for roughly a
    // minute per GB, so it runs in the night window (server local time) unless
    // RSS_SQLITE_COMPACT_NOW=1. The row phase runs at startup.
    const compactNow=(date=new Date())=>process.env.RSS_SQLITE_COMPACT_NOW==='1'||(date.getHours()>=2&&date.getHours()<6);
    function scheduleCompaction(){
        clearTimeout(compactionTimer);
        const next=new Date();next.setHours(3,30,0,0);if(next<=Date.now())next.setDate(next.getDate()+1);
        compactionTimer=setTimeout(()=>client.api.optimizeStorage({compact:true}).then(progress=>{
            if(!progress?.complete)scheduleCompaction();
        },error=>{console.error('[SQLITE COMPACTION DEFERRED]',error.message);scheduleCompaction();}),next-Date.now());
        compactionTimer.unref();
    }
    // The upgrade and the 6-hourly backup/maintenance are independent: a failed
    // or deferred upgrade must never stop backups.
    async function maintenanceTick(){
        try{const progress=await client.api.optimizeStorage({compact:compactNow()});if(progress?.rowsComplete&&!progress.complete)scheduleCompaction();}
        catch(error){console.error('[SQLITE UPGRADE DEFERRED]',error.message);}
        try{await client.api.maintenance();}catch(error){console.error('[SQLITE MAINTENANCE]',error.message);}
        await reportStaleBackups();
    }
    async function reportStaleBackups(){
        const latest=await latestBackupAt(root).catch(()=>0);
        if(Date.now()-latest>12*60*60*1000)
            console.error(`[SQLITE BACKUP STALE] No successful backup for ${latest?Math.round((Date.now()-latest)/3600000)+' h':'ever'} (database_state/sqlite-backups)`);
    }
    async function acquireDatabaseWriterLock(){
        try{lockHandle=await fs.open(lockFile,'wx',0o600);await lockHandle.writeFile(JSON.stringify({pid:process.pid,startedAt:Date.now()}));return lockHandle;}
        catch(error){if(error.code!=='EEXIST')throw error;const owner=JSON.parse(await fs.readFile(lockFile,'utf8'));
            try{process.kill(Number(owner.pid),0);}catch(e){if(e.code==='ESRCH'){await fs.unlink(lockFile);return acquireDatabaseWriterLock();}throw e;}
            throw Error(`Database writer lock is already held by process ${owner.pid}`);}
    }
    function releaseLock(){if(!lockHandle)return;try{if(JSON.parse(readFileSync(lockFile,'utf8')).pid===process.pid)unlinkSync(lockFile);}catch{}lockHandle.close().catch(()=>{});lockHandle=null;}
    return {
        env:{RSS_DATA:client.api,ADMIN_PASSWORD:process.env.ADMIN_PASSWORD},
        _writeJsonAtomic:(filename,value)=>writeCacheJson(client.api,filename,value,atomicJson,{root}),acquireDatabaseWriterLock,
        releaseParsedCache:client.releaseParsedCache,getResourceState:client.resourceState,
        async initializeWriterLock(enabled){
            if(enabled)await acquireDatabaseWriterLock();
            try{await client.initialize();}catch(error){releaseLock();throw error;}
            if(enabled){
                // One-time storage upgrade (verified pre-change backup first). A
                // failed/deferred upgrade must not also skip the startup backup.
                void client.api.optimizeStorage({compact:compactNow()}).catch(error=>{console.error('[SQLITE UPGRADE DEFERRED]',error.message);return {};})
                    .then(progress=>{if(progress?.rowsComplete&&!progress.complete)scheduleCompaction();return progress;})
                    .then(async progress=>{
                        if(Date.now()-Number(progress?.completedAt||progress?.startedAt||0)>6*60*60*1000 && !await hasRecentBackup(root))await client.api.backup({});
                    }).catch(error=>console.error('[SQLITE BACKUP]',error.message))
                    .then(()=>reportStaleBackups());
                process.once('exit',releaseLock);
                client.onFatal(error=>{console.error('[SQLITE FATAL]',error.message);setTimeout(()=>process.exit(1),1000).unref();});
                maintenanceTimer=setInterval(()=>void maintenanceTick(),6*60*60*1000);
                maintenanceTimer.unref();}
        },
        // The 6-hourly tick (exposed for operations and tests).
        runMaintenance:()=>maintenanceTick(),
        async close(){clearInterval(maintenanceTimer);clearTimeout(compactionTimer);await client.api.close();releaseLock();}
    };
}
