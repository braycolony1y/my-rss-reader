import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { openSqlite, assertIntegrity } from './connection.js';
import { assertOffline } from './offline.js';
import { atomicJson, fileHash, syncDirectory } from './files.js';

export async function restoreDatabase(root,source) {
    await assertOffline(root);
    const manifest=JSON.parse(await fs.readFile(source+'.manifest.json','utf8'));
    if(await fileHash(source)!==manifest.sha256)throw Error('Backup checksum mismatch');
    const verification=openSqlite(source,{readOnly:true});
    try{assertIntegrity(verification,{full:true});if(!verification.prepare("SELECT value FROM storage_meta WHERE name='migration_complete'").get())throw Error('Backup has no completed migration');}
    finally{verification.close();}
    const filename=path.join(root,'database_state','reader.sqlite'),suffix='.before-restore-'+randomUUID();
    await fs.mkdir(path.dirname(filename),{recursive:true,mode:0o700});
    const temporary=filename+'.restoring';await fs.copyFile(source,temporary);await fs.chmod(temporary,0o600);
    const handle=await fs.open(temporary,'r');try{await handle.sync();}finally{await handle.close();}
    // Quarantine the previous database AND sidecars together. Never attach an
    // old WAL to the restored database, and never erase forensic evidence.
    for(const extension of ['', '-wal','-shm'])await fs.rename(filename+extension,filename+suffix+extension).catch(error=>{if(error.code!=='ENOENT')throw error;});
    await fs.rename(temporary,filename);await syncDirectory(path.dirname(filename));
    await atomicJson(path.join(root,'database_state','last-restore.json'),{at:Date.now(),source,sha256:manifest.sha256,quarantine:filename+suffix});
    return {filename,restoredFrom:source};
}
