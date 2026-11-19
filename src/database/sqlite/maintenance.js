import fs from 'node:fs/promises';
import path from 'node:path';
import { backup } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { openSqlite, assertIntegrity } from './connection.js';
import { pruneDerivedCaches } from './retention-maintenance.js';
import { atomicJson, fileHash, syncDirectory } from './files.js';

export async function backupDatabase(db,root,{destination,retain=12}={}) {
    const directory=path.join(root,'database_state','sqlite-backups');
    await fs.mkdir(directory,{recursive:true,mode:0o700});
    const target=destination || path.join(directory,'reader-'+new Date().toISOString().replace(/[:.]/g,'-')+'.sqlite');
    // A terminated backup may leave an invalid SQLite destination. Never
    // reopen it on retry, or reuse another in-flight backup's destination.
    const temporary=target+'.partial-'+randomUUID();
    // A killed process cannot run the finally below; reclaim its database-sized
    // partials (never a published backup) once they are clearly abandoned.
    for(const folder of new Set([directory,path.dirname(target)])){
        for(const name of await fs.readdir(folder).catch(()=>[])){
            if(!/\.sqlite(?:-[0-9]+\.sqlite)?\.partial-[0-9a-f-]{36}(?:-journal|-wal|-shm)?$/.test(name))continue;
            const file=path.join(folder,name),info=await fs.stat(file).catch(()=>null);
            if(info&&Date.now()-info.mtimeMs>60*60*1000)await fs.rm(file,{force:true});
        }
    }
    if(await fs.stat(target).then(()=>true,()=>false))throw Error('Backup destination already exists');
    try {
        // One step (rate -1) copies the whole file inside a single WAL read
        // snapshot. With incremental steps, SQLite restarts the backup from
        // page 1 whenever ANOTHER connection writes between steps, so under a
        // steady trickle of saves a 1 GB backup never finished (measured: still
        // 70% after 6.5 minutes with one write per second). Runs on the libuv
        // pool in the maintenance worker; readers and writers are not blocked.
        await backup(db,temporary,{rate:-1});
        const verification=openSqlite(temporary,{readOnly:true});
        // Full verification probes every index. A transient 64 MiB cache avoids
        // millions of random page re-reads; ordinary readers stay at 32 MiB.
        verification.exec('PRAGMA cache_size=-65536');
        let collections;
        try{assertIntegrity(verification,{full:true});collections=verification.prepare('SELECT name,revision,digest,item_count FROM collections ORDER BY name').all();}
        finally{verification.close();}
        await fs.chmod(temporary,0o600);
        const handle=await fs.open(temporary,'r');try{await handle.sync();}finally{await handle.close();}
        // Publish without replacing a backup that raced this operation.
        await fs.link(temporary,target);await fs.unlink(temporary);await syncDirectory(path.dirname(target));
        await atomicJson(target+'.manifest.json',{createdAt:Date.now(),sha256:await fileHash(target),collections});
        // Only files created by this procedure are rotated. Legacy JSON is untouched.
        if(!destination){const names=(await fs.readdir(directory)).filter(name=>/^reader-.*\.sqlite$/.test(name)).sort().reverse();
            for(const name of names.slice(retain)){await fs.rm(path.join(directory,name));await fs.rm(path.join(directory,name+'.manifest.json'),{force:true});}}
        return {filename:target,bytes:(await fs.stat(target)).size,collections:collections.length};
    } finally {
        for(const extension of ['', '-wal', '-shm'])await fs.rm(temporary+extension,{force:true});
    }
}

// Runs while main-connection writes are held, so it does no integrity scan:
// the preceding backup ran a full integrity_check of a snapshot, and
// checkDatabase() runs read-only outside the hold.
export function maintainDatabase(db) {
    db.exec('BEGIN IMMEDIATE');
    let pruned;
    try { pruned=pruneDerivedCaches(db);db.exec('COMMIT'); } catch(error) { db.exec('ROLLBACK');throw error; }
    db.exec('PRAGMA optimize; PRAGMA wal_checkpoint(PASSIVE); PRAGMA incremental_vacuum(2048);');
    // Do not guess expiry policies for saved stories or editorial state. File
    // cache retention continues through the existing application cleanup owner.
    return {pruned,pageCount:db.prepare('PRAGMA page_count').get().page_count,
        freePages:db.prepare('PRAGMA freelist_count').get().freelist_count};
}

// Read-only: quick_check plus foreign-key check. Never holds writes.
export function checkDatabase(db) {
    assertIntegrity(db);
    return {integrity:'ok',pageCount:db.prepare('PRAGMA page_count').get().page_count,
        freePages:db.prepare('PRAGMA freelist_count').get().freelist_count};
}
