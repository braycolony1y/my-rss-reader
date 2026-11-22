import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertOffline } from './offline.js';
import { openSqlite, assertIntegrity } from './connection.js';
import { exportLegacyDatabase } from './export.js';
import { backupDatabase } from './maintenance.js';
import { ensureSqlite } from './migration.js';
import { createRepository } from './repository.js';
import { atomicJson, exists, syncDirectory } from './files.js';
import { cacheFilePath } from './cache-files.js';

export async function rollbackToJson(root){
    await assertOffline(root);
    const id='rollback-'+randomUUID(),directory=path.join(root,'database_state',id),exported=path.join(directory,'export');
    const db=openSqlite(path.join(root,'database_state/reader.sqlite'));
    try{
        assertIntegrity(db,{full:true});await backupDatabase(db,root);
        const manifest=await exportLegacyDatabase(db,exported);
        const check=await ensureSqlite({root:exported,filename:path.join(exported,'database_state/reader.sqlite')});
        try{
            const repository=createRepository(check);
            for(const entry of manifest){const restored=repository.info(entry.key);
                if(restored?.digest!==entry.digest||restored.encoding!==entry.encoding||restored.shape!==entry.shape)throw Error(`Rollback round-trip mismatch: ${entry.key}`);}
        }finally{check.close();}
        const originals=path.join(directory,'originals');
        const replace=async relative=>{
            const destination=path.join(root,relative),saved=path.join(originals,relative);
            if(await exists(destination)){await fs.mkdir(path.dirname(saved),{recursive:true,mode:0o700});await fs.rename(destination,saved);}
            if(await exists(path.join(exported,relative))){await fs.mkdir(path.dirname(destination),{recursive:true});await fs.copyFile(path.join(exported,relative),destination);}
        };
        for(const name of ['database.json','smart-data.json','database-state.json','smart-state.json'])await replace(name);
        // Apply both active records and tombstones; old original cache files
        // must not reappear after an explicit rollback.
        for(const row of db.prepare('SELECT path FROM cache_files').iterate()){
            if(cacheFilePath(root,path.join(root,row.path))!==row.path)throw Error('Invalid cache rollback path');
            await replace(row.path);
        }
        await syncDirectory(root);
        await atomicJson(path.join(root,'database_state/backend.json'),{backend:'json',id,verifiedAt:Date.now(),preservedOriginals:originals});
        return {backend:'json',verified:true,preservedOriginals:originals,exported};
    }finally{db.close();}
}
