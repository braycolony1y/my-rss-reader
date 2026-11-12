import { parentPort,workerData } from 'node:worker_threads';
import { openSqlite } from './connection.js';
import { backupDatabase,maintainDatabase } from './maintenance.js';
let db;
try{
    db=openSqlite(workerData.filename,{readOnly:workerData.action==='backup'});
    const result=workerData.action==='backup'?await backupDatabase(db,workerData.root,workerData.options):maintainDatabase(db);
    parentPort.postMessage({result});
}catch(error){parentPort.postMessage({error:{message:error.message,code:error.code}});}
finally{db?.close();parentPort.close();}
