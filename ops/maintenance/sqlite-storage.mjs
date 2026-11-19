import path from 'node:path';
import { createSqliteDatabaseStore } from '../../src/database/sqlite/store.js';
import { openSqlite } from '../../src/database/sqlite/connection.js';
import { exportLegacyDatabase } from '../../src/database/sqlite/export.js';
import { restoreDatabase } from '../../src/database/sqlite/restore.js';
import { assertOffline } from '../../src/database/sqlite/offline.js';
import { rollbackToJson } from '../../src/database/sqlite/rollback.js';
import { backupDatabase, checkDatabase } from '../../src/database/sqlite/maintenance.js';

const [action='check',argument,rootArgument]=process.argv.slice(2);
const root=path.resolve(rootArgument||(!['backup','restore','export-legacy'].includes(action)?argument:null)||process.env.RSS_READER_DIR||process.cwd());
if(action==='rollback-json'){
    console.log(JSON.stringify(await rollbackToJson(root),null,2));
}else if(action==='restore'){
    if(!argument)throw Error('Usage: sqlite-storage.mjs restore BACKUP [ROOT]');
    console.log(JSON.stringify(await restoreDatabase(root,path.resolve(argument)),null,2));
}else if(action==='export-legacy'){
    if(!argument)throw Error('Usage: sqlite-storage.mjs export-legacy EMPTY_DIRECTORY [ROOT]');
    await assertOffline(root);
    const db=openSqlite(path.join(root,'database_state/reader.sqlite'),{readOnly:true});
    try{console.log(JSON.stringify(await exportLegacyDatabase(db,path.resolve(argument)),null,2));}finally{db.close();}
}else if(['check','backup'].includes(action)){
    // Read-only connection: safe while the server runs (it never writes the
    // database, so it cannot contend for the live writer's lock).
    const db=openSqlite(path.join(root,'database_state/reader.sqlite'),{readOnly:true});
    try{
        const result=action==='backup'?await backupDatabase(db,root,argument?{destination:path.resolve(argument)}:{}):checkDatabase(db);
        console.log(JSON.stringify(result,null,2));
    }finally{db.close();}
}else if(action==='migrate'){
    // Writes the database: refuse while the server holds the writer lock.
    await assertOffline(root);
    const store=createSqliteDatabaseStore({root});
    try{
        await store.initializeWriterLock(false);
        console.log(JSON.stringify({migrated:true,filename:path.join(root,'database_state/reader.sqlite')},null,2));
    }finally{await store.close();}
}else throw Error('Choose check, backup, migrate, restore, export-legacy, or rollback-json');
