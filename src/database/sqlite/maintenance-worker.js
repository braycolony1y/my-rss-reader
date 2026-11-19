import { parentPort,workerData } from 'node:worker_threads';
import { openSqlite } from './connection.js';
import { prepareStorageUpgrade, upgradeStorage } from './storage-upgrade.js';
import { backupDatabase,maintainDatabase,checkDatabase } from './maintenance.js';
let db;
try{
    db=openSqlite(workerData.filename,{readOnly:['backup','check'].includes(workerData.action)});
    const result=workerData.action==='backup'?await backupDatabase(db,workerData.root,workerData.options)
        :workerData.action==='prepareUpgrade'?await prepareStorageUpgrade(db,workerData.root)
        :workerData.action==='check'?checkDatabase(db)
        :workerData.action==='upgrade'?await upgradeStorage(db,workerData.root,{prepared:true,phase:workerData.options?.phase}):maintainDatabase(db);
    parentPort.postMessage({result});
}catch(error){parentPort.postMessage({error:{message:error.message,code:error.code}});}
finally{db?.close();parentPort.close();}
