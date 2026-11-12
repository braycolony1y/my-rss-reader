import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createSqliteDatabaseStore } from '../../../src/database/sqlite/store.js';
import { restoreDatabase } from '../../../src/database/sqlite/restore.js';
import { openSqlite } from '../../../src/database/sqlite/connection.js';

const [root,output]=process.argv.slice(2);if(!root||!output)throw Error('Usage: sqlite-restore.mjs ROOT OUTPUT');
const source=createSqliteDatabaseStore({root});let backup;
try{await source.initializeWriterLock(false);backup=await source.env.RSS_DATA.backup({});}finally{await source.close();}
const restoredRoot=await fs.mkdtemp('/tmp/rss-sqlite-restored-');
await restoreDatabase(restoredRoot,backup.filename);
const left=openSqlite(path.join(root,'database_state/reader.sqlite'),{readOnly:true}),right=openSqlite(path.join(restoredRoot,'database_state/reader.sqlite'),{readOnly:true});
const tables=['sources','feeds','articles','cluster_members','rankings','reading_states','boards','preferences','metadata_entries','cache_files','archive_entries'];
const counts={};
try{
    assert.deepEqual(right.prepare('SELECT name,encoding,shape,digest,item_count,revision FROM collections ORDER BY name').all(),left.prepare('SELECT name,encoding,shape,digest,item_count,revision FROM collections ORDER BY name').all());
    for(const table of tables){const count=left.prepare(`SELECT count(*) n FROM ${table}`).get().n;assert.equal(right.prepare(`SELECT count(*) n FROM ${table}`).get().n,count,table);counts[table]=count;}
    const iterator=right.prepare('SELECT path,digest,deleted FROM cache_files ORDER BY path').iterate();
    for(const row of left.prepare('SELECT path,digest,deleted FROM cache_files ORDER BY path').iterate())assert.deepEqual(iterator.next().value,row);
    assert.equal(iterator.next().done,true);
}finally{left.close();right.close();}
const report={at:Date.now(),verified:true,backup,restoredRoot,counts};
await fs.writeFile(output,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
