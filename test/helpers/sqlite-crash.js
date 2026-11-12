import { openSqlite } from '../../src/database/sqlite/connection.js';
import { createRepository } from '../../src/database/sqlite/repository.js';
const db=openSqlite(process.argv[2]),repository=createRepository(db);
db.exec('BEGIN IMMEDIATE');repository.write('counter','999');
if(process.argv[3]==='commit')db.exec('COMMIT');
process.stdout.write('READY\n');
setInterval(()=>{},1000);
