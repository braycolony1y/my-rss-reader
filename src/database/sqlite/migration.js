import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { openSqlite, assertIntegrity } from './connection.js';
import { createRepository } from './repository.js';
import { importLegacy } from './importer.js';
import { atomicJson, fileHash, exists, syncDirectory } from './files.js';
import { hash, tableFor, CHILD_FIELDS } from './codec.js';
import { assertOffline } from './offline.js';
import { importCacheFiles } from './cache-files.js';

async function captureLegacy(root,directory) {
    await fs.mkdir(directory,{recursive:true,mode:0o700});
    const files=[];
    const collect=async relative=>{
        const source=path.join(root,relative);if(!await exists(source))return;
        const stat=await fs.stat(source);
        if(stat.isDirectory()){for(const name of await fs.readdir(source))await collect(path.join(relative,name));return;}
        if(!stat.isFile())throw Error('Non-file legacy migration input');
        const target=path.join(directory,relative);await fs.mkdir(path.dirname(target),{recursive:true,mode:0o700});
        await fs.copyFile(source,target);await fs.chmod(target,0o600);
        const copied=await fs.open(target,'r');try{await copied.sync();}finally{await copied.close();}
        files.push({path:relative,bytes:stat.size,sha256:await fileHash(target),mtimeMs:stat.mtimeMs});
    };
    for(const name of ['database.json','database.json.backup','smart-data.json','smart-data.json.backup',
        'database-state.json','smart-state.json','feeds_backup.json','feeds_backup.json.backup',
        'database_state/database-state.json','database_state/smart-state.json'])await collect(name);
    // Recovery candidates are staged too, so the importer cannot accidentally
    // consult changing live files while recovering a damaged main snapshot.
    const rotations=await fs.readdir(path.join(root,'db_backups')).catch(()=>[]);
    for(const name of rotations.filter(name=>/^database-.*\.json$/.test(name)))await collect(path.join('db_backups',name));
    for(const file of files){const current=await fs.stat(path.join(root,file.path));
        if(current.size!==file.bytes||current.mtimeMs!==file.mtimeMs)throw Error('Legacy storage changed during migration; stop the writer and retry');}
    return files;
}

async function ensureSqliteUnlocked({root,filename}) {
    const marker=path.join(root,'database_state','sqlite-cutover.json');
    if(await exists(filename)) {
        const db=openSqlite(filename);try{
            if(!db.prepare("SELECT value FROM storage_meta WHERE name='migration_complete'").get())throw Error('Incomplete SQLite migration');
        }catch(error){db.close();throw error;}
        if(!await exists(marker))await atomicJson(marker,{filename,completedAt:Date.now(),recoveredMarker:true});
        return db;
    }
    if(await exists(marker))throw Error('SQLite database missing after cutover; restore a verified SQLite backup. Legacy JSON will not be replayed.');
    let owner;
    try{owner=JSON.parse(await fs.readFile(path.join(root,'database.writer.lock'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
    if(owner?.pid!==process.pid&&(owner||path.resolve(root)==='/home/ubuntu/my-rss-reader'))await assertOffline(root);
    const id=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID();
    const directory=path.join(root,'database_state','sqlite-migrations',id);
    const legacy=path.join(directory,'legacy');
    const sources=await captureLegacy(root,legacy);
    await atomicJson(path.join(directory,'sources.json'),sources);
    await fs.mkdir(path.dirname(filename),{recursive:true,mode:0o700});
    const stage=filename+'.migration-'+id;
    const db=openSqlite(stage),repository=createRepository(db);
    // Import touches several indexes repeatedly. A bounded 64 MiB import cache
    // avoids dirty-page churn; normal runtime connections retain the 8 MiB cap.
    db.exec('PRAGMA cache_size=-65536');
    const startedAt=Date.now();let report;
    try {
        db.exec('BEGIN IMMEDIATE');
        const imported=await importLegacy(legacy,db,repository);
        // Every imported row is re-read and its original structural hash checked.
        const validated=[];
        for(const key of repository.keys({internal:true})) {
            const info=repository.info(key);
            let count=0;
            if(info.shape!=='scalar')for(const entry of repository.entries(key)){
                const comparable=CHILD_FIELDS[key]?.has(entry.key)&&entry.value&&typeof entry.value==='object'
                    ? {$sqliteCollection:`$${key}.${entry.key}`} : entry.value;
                if(hash(JSON.stringify(comparable))!==entry.digest)throw Error(`Migration content mismatch: ${key}/${entry.key}`);
                count++;
            }
            if(count!==info.item_count)throw Error(`Migration count mismatch: ${key}`);
            validated.push({key,count,revision:info.revision,digest:info.digest});
            console.info('[SQLITE VALIDATED]',key,count,'records');
        }
        const cacheFiles=await importCacheFiles(root,db);
        assertIntegrity(db,{full:true});
        report={id,startedAt,completedAt:Date.now(),sources,imported,validated,cacheFiles};
        db.prepare('INSERT INTO storage_meta VALUES(?,?)').run('migration_complete',JSON.stringify(report));
        db.exec('COMMIT; PRAGMA wal_checkpoint(TRUNCATE)');
    } catch(error) {
        if(db.isTransaction)db.exec('ROLLBACK');db.close();throw error;
    }
    db.close();
    await fs.rename(stage,filename);await syncDirectory(path.dirname(filename));
    await atomicJson(path.join(directory,'validation.json'),report);
    await atomicJson(marker,{filename,id,completedAt:report.completedAt,sourceBackup:legacy});
    return openSqlite(filename);
}

export async function ensureSqlite(options) {
    const lock=options.filename+'.migration.lock';
    await fs.mkdir(path.dirname(lock),{recursive:true,mode:0o700});
    let handle;
    for(let attempt=0;attempt<1200;attempt++){
        try{handle=await fs.open(lock,'wx',0o600);await handle.writeFile(JSON.stringify({pid:process.pid}));break;}
        catch(error){
            if(error.code!=='EEXIST')throw error;
            try{const owner=JSON.parse(await fs.readFile(lock,'utf8'));process.kill(owner.pid,0);}
            catch(ownerError){if(ownerError.code==='ESRCH'){await fs.rm(lock,{force:true});continue;}if(ownerError.code!=='ENOENT'&&!(ownerError instanceof SyntaxError))throw ownerError;}
            await new Promise(resolve=>setTimeout(resolve,50));
        }
    }
    if(!handle)throw Error('SQLite migration lock is busy; migration was not repeated');
    try{return await ensureSqliteUnlocked(options);}
    finally{await handle.close();await fs.rm(lock,{force:true});}
}
