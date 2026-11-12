import fs from 'node:fs/promises';
import path from 'node:path';
import { backup } from 'node:sqlite';
import { openSqlite, assertIntegrity } from './connection.js';
import { atomicJson, fileHash, syncDirectory } from './files.js';

export async function backupDatabase(db,root,{destination,retain=12}={}) {
    const directory=path.join(root,'database_state','sqlite-backups');
    await fs.mkdir(directory,{recursive:true,mode:0o700});
    const target=destination || path.join(directory,'reader-'+new Date().toISOString().replace(/[:.]/g,'-')+'.sqlite');
    const temporary=target+'.partial';
    if(await fs.stat(target).then(()=>true,()=>false))throw Error('Backup destination already exists');
    await backup(db,temporary,{rate:256});
    const verification=openSqlite(temporary,{readOnly:true});
    let collections;
    try{assertIntegrity(verification,{full:true});collections=verification.prepare('SELECT name,revision,digest,item_count FROM collections ORDER BY name').all();}
    finally{verification.close();}
    await fs.chmod(temporary,0o600);
    const handle=await fs.open(temporary,'r');try{await handle.sync();}finally{await handle.close();}
    await fs.rename(temporary,target);await syncDirectory(path.dirname(target));
    await atomicJson(target+'.manifest.json',{createdAt:Date.now(),sha256:await fileHash(target),collections});
    // Only files created by this procedure are rotated. Legacy JSON is untouched.
    if(!destination){const names=(await fs.readdir(directory)).filter(name=>/^reader-.*\.sqlite$/.test(name)).sort().reverse();
        for(const name of names.slice(retain)){await fs.rm(path.join(directory,name));await fs.rm(path.join(directory,name+'.manifest.json'),{force:true});}}
    return {filename:target,bytes:(await fs.stat(target)).size,collections:collections.length};
}

export function maintainDatabase(db) {
    assertIntegrity(db);
    db.exec('PRAGMA optimize; PRAGMA wal_checkpoint(PASSIVE);');
    // Do not guess expiry policies for saved stories or editorial state. File
    // cache retention continues through the existing application cleanup owner.
    return {integrity:'ok',pageCount:db.prepare('PRAGMA page_count').get().page_count,
        freePages:db.prepare('PRAGMA freelist_count').get().freelist_count};
}
