import path from 'node:path';
import fs from 'node:fs/promises';
import { readFileSync, unlinkSync } from 'node:fs';
import { createSqliteClient } from './client.js';
import { atomicJson } from './files.js';
import { writeCacheJson } from '../cache-filesystem.js';
import { hasRecentBackup } from './backup-selection.js';

export function createSqliteDatabaseStore({root=process.cwd(),filename,backupOnOpen=false}={}) {
    root=path.resolve(root);
    const client=createSqliteClient({root,filename:filename||path.join(root,'database_state','reader.sqlite'),backupOnOpen});
    const lockFile=path.join(root,'database.writer.lock');let lockHandle,maintenanceTimer;
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
            if(enabled){process.once('exit',releaseLock);
                client.onFatal(error=>{console.error('[SQLITE FATAL]',error.message);setTimeout(()=>process.exit(1),1000).unref();});
                if(!await hasRecentBackup(root))
                    void client.api.backup({}).catch(error=>console.error('[SQLITE BACKUP]',error.message));
                maintenanceTimer=setInterval(()=>client.api.maintenance().then(()=>client.api.backup({})).catch(error=>console.error('[SQLITE MAINTENANCE]',error.message)),6*60*60*1000);
                maintenanceTimer.unref();}
        },
        async close(){clearInterval(maintenanceTimer);await client.api.close();releaseLock();}
    };
}
