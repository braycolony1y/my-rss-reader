import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openSqlite } from '../src/database/sqlite/connection.js';
import { SCHEMA } from '../src/database/sqlite/schema.js';
import { createRepository } from '../src/database/sqlite/repository.js';
import { createCacheFiles } from '../src/database/sqlite/cache-files.js';
import { upgradeStorage, prepareStorageUpgrade } from '../src/database/sqlite/storage-upgrade.js';
import { backupDatabase, maintainDatabase, checkDatabase } from '../src/database/sqlite/maintenance.js';
import { restoreDatabase } from '../src/database/sqlite/restore.js';
import { CACHE_RETENTION, boundCacheObject } from '../src/database/sqlite/cache-retention.js';
import { pruneDerivedCaches } from '../src/database/sqlite/retention-maintenance.js';
import { createSqliteDatabaseStore } from '../src/database/sqlite/store.js';

async function directory(t){const root=await fs.mkdtemp('/tmp/backend-perf-');t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
const pragma=(db,name)=>Object.values(db.prepare('PRAGMA '+name).get())[0];
test('connection budgets, WAL durability, optimizer and incremental vacuum policy',async t=>{
    const root=await directory(t),file=path.join(root,'reader.sqlite');
    const writer=openSqlite(file),reader=openSqlite(file,{readOnly:true}),maintenance=openSqlite(file,{maintenance:true});
    try{
        assert.equal(pragma(writer,'journal_mode'),'wal');assert.equal(pragma(writer,'synchronous'),2);
        assert.equal(pragma(writer,'cache_size'),-32768);assert.equal(pragma(reader,'cache_size'),-32768);
        assert.equal(pragma(maintenance,'cache_size'),-32768);
        // File-backed temp b-trees (VACUUM must not build a RAM copy) and no mmap
        // (mapped pages inflate the RSS used by the worker memory budget).
        for(const db of [writer,reader,maintenance]){assert.equal(pragma(db,'temp_store'),1);assert.equal(pragma(db,'mmap_size'),0);}
        assert.equal(pragma(writer,'journal_size_limit'),16777216);
    }finally{reader.close();maintenance.close();writer.close();}
});

test('retention is finite, respects source TTLs and never admits user-state keys',()=>{
    const now=Date.now(),day=86400000;
    // Resolved mappings outlive the owner's 30-day re-resolution TTL: saved/Board
    // Google News stories find their cached content through them.
    const entries={expired:{cachedAt:now-181*day,resolvedUrl:'a'},owner:{cachedAt:now-31*day,resolvedUrl:'c'},fresh:{cachedAt:now-1000,resolvedUrl:'b'},failed:{cachedAt:now-25*3600000},retry:{cachedAt:now-1000}};
    // Without reference information (write path) resolved mappings are never
    // evicted; only stale failures are dropped.
    assert.deepEqual(Object.keys(boundCacheObject('googleNewsUrlCache',entries,now)),['expired','owner','fresh','retry']);
    for(const key of ['constructor','toString','__proto__','readStates','savedStates','hiddenStates','boardStates','recentReadAt','userPreferences','feeds','cacheMembers','cacheIdentityLedger','$cacheIdentityLedger.articles','smartPersonalFilters','topStoriesState','storyBriefings','articleFetchStrategyStats','smartEditorialAssessmentCache','smartEventVerificationCache','smartVerificationFailures']){
        assert.ok(!Object.hasOwn(CACHE_RETENTION,key));assert.equal(boundCacheObject(key,entries,now),entries);
    }
});

test('cache listing keeps exact prefix semantics for supplementary Unicode and tombstones',async t=>{
    const root=await directory(t),db=openSqlite(path.join(root,'reader.sqlite'));
    try{
        const cache=createCacheFiles(db),paths=['article_cache/a.json','article_cache/😀.json','article_cache/\uffffx.json','article_cache/threads/a.json','article_cache2/other.json'];
        for(const name of paths)cache.put(name,'{}');
        cache.remove(paths[1]);
        assert.deepEqual(new Set(cache.list('article_cache/').map(row=>row.path)),new Set(paths.slice(0,-1)));
        assert.equal(cache.list('article_cache/😀')[0].deleted,1);
        assert.equal(cache.list('').length,paths.length);
        assert.equal(cache.list('article_cache/\uffff')[0].path,paths[2]);
    }finally{db.close();}
});

test('full and paged cluster reads use one member query including empty member arrays',async t=>{
    const root=await directory(t),db=openSqlite(path.join(root,'reader.sqlite'));
    try{
        let childQueries=0;const prepare=db.prepare.bind(db);
        db.prepare=sql=>{const statement=prepare(sql);return new Proxy(statement,{get(target,property){const value=Reflect.get(target,property);return typeof value==='function'?(...args)=>{if(['get','all','iterate'].includes(property)&&sql.includes('FROM cluster_members'))childQueries++;return value.apply(target,args);}:value;}});};
        const repo=createRepository(db),clusters=Array.from({length:40},(_,i)=>({clusterId:String(i),link:'https://a/'+i,relatedArticles:i%2?[]:[{link:'https://member/'+i}]}));
        repo.write('smartClusters',JSON.stringify(clusters));childQueries=0;
        assert.deepEqual(JSON.parse(repo.read('smartClusters')),clusters);assert.equal(childQueries,1);
        childQueries=0;assert.deepEqual(repo.findArticles('smartClusters',{limit:10}),clusters.slice(0,10));assert.equal(childQueries,1);
    }finally{db.close();}
});

test('derived cache timestamps and byte caps apply without changing unknown collections',async t=>{
    const now=Date.now(),day=86400000;
    // Unresolved Google News lookups are failures: kept one day, never trusted with bad or future times.
    const entries={fresh:{cachedAt:now-1000},expired:{cachedAt:now-2*day},bad:{cachedAt:'bad'},future:{cachedAt:now+day}};
    assert.deepEqual(Object.keys(boundCacheObject('googleNewsUrlCache',entries,now)),['fresh']);
    // Retired AI caches are left alone: archived rows must not be pruned before delete-ai-data removes them.
    const stale={old:{createdAt:now-90*day}};
    assert.equal(boundCacheObject('smartEventVerificationCache',stale,now),stale);
    const root=await directory(t),db=openSqlite(path.join(root,'reader.sqlite'));
    const policy=CACHE_RETENTION.googleNewsUrlCache,originalMaxBytes=policy.maxBytes;
    try{
        policy.maxBytes=25*1024*1024;
        const repo=createRepository(db),payload='x'.repeat(10*1024*1024),key='googleNewsUrlCache';
        for(let i=0;i<3;i++)repo.patchMap(key,{[i]:{cachedAt:now-i,payload}});
        // Patches never sweep the collection; maintenance applies the byte cap.
        assert.equal(repo.info(key).item_count,3);
        db.exec('BEGIN');assert.equal(pruneDerivedCaches(db,now).googleNewsUrlCache,1);db.exec('COMMIT');
        assert.equal(repo.info(key).item_count,2);assert.deepEqual(Object.keys(JSON.parse(repo.read(key))),['0','1']);
        assert.equal(repo.info(key).digest,(()=>{const other=createRepository(db);other.write('comparison',repo.read(key));return other.info('comparison').digest;})());
        repo.patchMap('cacheIdentityLedger',{articles:{one:{auto_added:false}}});const first=repo.info('cacheIdentityLedger');
        repo.patchMap('cacheIdentityLedger',{articles:{two:{auto_added:true}}});const second=repo.info('cacheIdentityLedger');
        assert.notEqual(first.digest,second.digest);assert.ok(second.revision>first.revision);
    }finally{policy.maxBytes=originalMaxBytes;db.close();}
});

test('failed compaction rolls back pruning and retries from the verified backup',async t=>{
    const root=await directory(t),file=path.join(root,'database_state/reader.sqlite');await fs.mkdir(path.dirname(file));
    let db=new DatabaseSync(file);db.exec(SCHEMA.replace(') STRICT, WITHOUT ROWID;',') STRICT;'));
    db.prepare('INSERT INTO storage_meta VALUES(?,?)').run('migration_complete','{}');
    const repo=createRepository(db);repo.write('googleNewsUrlCache','{}');
    db.prepare('INSERT INTO metadata_entries VALUES(?,?,?,?,?)').run('googleNewsUrlCache','expired',0,'{"cachedAt":1,"resolvedUrl":"old"}','old');
    repo.refreshDigest('googleNewsUrlCache');db.close();db=openSqlite(file);
    try{
        const exec=db.exec.bind(db);
        db.exec=sql=>{if(sql==='COMMIT')throw Error('injected compaction failure');return exec(sql);};
        await assert.rejects(upgradeStorage(db,root),/injected compaction failure/);
        db.exec=exec;
        assert.equal(createRepository(db).info('googleNewsUrlCache').item_count,1);
        const before=JSON.parse(db.prepare('SELECT detail FROM maintenance_runs WHERE kind=?').get('backend-storage-v2').detail);
        assert.equal(before.rowsComplete,undefined);
        const complete=await upgradeStorage(db,root);assert.equal(complete.backup,before.backup);assert.equal(complete.complete,true);
    }finally{db.close();}
});

test('backup can retry over an interrupted temporary destination',async t=>{
    const root=await directory(t),target=path.join(root,'backup.sqlite'),db=openSqlite(path.join(root,'reader.sqlite'));
    try{
        await fs.writeFile(target+'.partial','interrupted backup');
        await backupDatabase(db,root,{destination:target});
        const manifest=JSON.parse(await fs.readFile(target+'.manifest.json','utf8'));
        assert.match(manifest.sha256,/^[a-f0-9]{64}$/);
        const copy=openSqlite(target,{readOnly:true});try{assert.equal(pragma(copy,'integrity_check'),'ok');}finally{copy.close();}
    }finally{db.close();}
});

test('pre-change backup, transactional upgrade, idempotent maintenance and verified rollback preserve user/cache state',async t=>{
    const root=await directory(t),file=path.join(root,'database_state/reader.sqlite');await fs.mkdir(path.dirname(file));
    let db=new DatabaseSync(file);
    db.exec(SCHEMA.replace(') STRICT, WITHOUT ROWID;',') STRICT;'));
    db.prepare('INSERT INTO storage_meta VALUES(?,?)').run('migration_complete','{}');
    const repo=createRepository(db),now=Date.now();
    const state={feeds:'[{"url":"https://feed.example"}]',articles:'[{"link":"https://story.example","saved":true,"read":true}]',
        readStates:'["read"]',savedStates:'["saved"]',hiddenStates:'["hidden"]',boardStates:'["board"]',recentReadAt:'{"read":123}',
        userPreferences:'{"theme":"glass","voice":{"cursor":1}}',cacheMembers:'{"board":{"thread_id":"x"}}',
        cacheIdentityLedger:'{"articles":{"known":{"auto_added":false,"last_seen_at":1}},"dismissals":{"x":1}}',
        smartPersonalFilters:'{"rules":[{"text":"user"}],"events":[{"undo":"x"}]}',
        articleFetchStrategyStats:'{"example":{"direct":{"userPreference":-1,"lastPreferenceAt":"old"}}}',
        topStoriesState:'{"continuity":{"material_version":3}}'};
    db.exec('BEGIN');for(const [key,value]of Object.entries(state))repo.write(key,value);db.exec('COMMIT');
    // Seed old rows through SQL: normal writes already apply retention.
    repo.write('googleNewsUrlCache','{}');
    db.prepare('INSERT INTO metadata_entries VALUES(?,?,?,?,?)').run('googleNewsUrlCache','expired',0,JSON.stringify({cachedAt:now-200*86400000,resolvedUrl:'x'}),'old');
    repo.refreshDigest('googleNewsUrlCache');
    const files=createCacheFiles(db);
    files.put('article_cache/old.json','{"result":{"content":"kept"}}');files.put('article_cache/deleted.json','{}');files.remove('article_cache/deleted.json');
    const archive='article_cache/threads/'+ 'a'.repeat(64)+'.json';files.put(archive,JSON.stringify({posts:{one:{current_content:'board history'}},legacy_snapshots:[{content:'old'}]}));
    const cacheRows=db.prepare('SELECT * FROM cache_files ORDER BY path').all(),archiveRows=db.prepare('SELECT * FROM archive_entries ORDER BY path,field,entry_key').all();
    db.close();db=openSqlite(file);
    const progress=await upgradeStorage(db,root);assert.equal(progress.complete,true);
    // The table layout is unchanged (no WITHOUT ROWID rebuild): HEAD code runs on it.
    assert.equal(pragma(db,'auto_vacuum'),2);assert.doesNotMatch(db.prepare("SELECT sql FROM sqlite_schema WHERE name='metadata_entries'").get().sql,/WITHOUT ROWID/);
    for(const [key,value]of Object.entries(state))assert.deepEqual(JSON.parse(createRepository(db).read(key)),JSON.parse(value),key);
    assert.deepEqual(db.prepare('SELECT * FROM cache_files ORDER BY path').all(),cacheRows);
    assert.deepEqual(db.prepare('SELECT * FROM archive_entries ORDER BY path,field,entry_key').all(),archiveRows);
    assert.equal(createRepository(db).info('googleNewsUrlCache').item_count,0);
    assert.equal((await upgradeStorage(db,root)).backup,progress.backup);
    const first=maintainDatabase(db),second=maintainDatabase(db);assert.ok(first.pruned);assert.equal(checkDatabase(db).integrity,'ok');assert.equal(second.pruned.googleNewsUrlCache,0);
    db.close();await restoreDatabase(root,progress.backup);
    db=openSqlite(file,{readOnly:true});
    try{assert.equal(createRepository(db).info('googleNewsUrlCache').item_count,1);for(const [key,value]of Object.entries(state))assert.deepEqual(JSON.parse(createRepository(db).read(key)),JSON.parse(value));}finally{db.close();}
});

test('batched reads revalidate other-writer revisions and protect shared identity',async t=>{
    const root=await directory(t);await fs.writeFile(path.join(root,'database.json'),JSON.stringify({articles:'[]',feeds:'[]',userPreferences:'{"theme":"glass"}',version:'opaque'}));
    const left=createSqliteDatabaseStore({root}),right=createSqliteDatabaseStore({root});
    try{
        const api=left.env.RSS_DATA;const one=await api.getMany(['userPreferences','version','missing'],{shared:true});
        assert.equal(one.version,'opaque');assert.equal(one.missing,null);
        const two=await api.getMany(['userPreferences'],{shared:true});assert.equal(one.userPreferences,two.userPreferences);
        const copy=await api.getMany(['userPreferences']);copy.userPreferences.theme='mutated';assert.equal(two.userPreferences.theme,'glass');
        await right.env.RSS_DATA.put('userPreferences','{"theme":"classic"}');
        const three=await api.getMany(['userPreferences'],{shared:true});assert.equal(three.userPreferences.theme,'classic');assert.notEqual(three.userPreferences,two.userPreferences);
    }finally{await left.close();await right.close();}
});

test('upgrade drains queued saves, invalidates prepared schemas and close prevents later upgrade phases',async t=>{
    const root=await directory(t);await fs.writeFile(path.join(root,'database.json'),JSON.stringify({articles:'[]',feeds:'[]',counter:'0',userPreferences:'{"theme":"glass"}'}));
    const filename=path.join(root,'database_state/reader.sqlite');await fs.mkdir(path.dirname(filename));
    const original=new DatabaseSync(filename);original.exec(SCHEMA.replace(') STRICT, WITHOUT ROWID;',') STRICT;'));
    original.prepare('INSERT INTO storage_meta VALUES(?,?)').run('migration_complete','{}');
    const originalRepo=createRepository(original);
    for(const [key,value]of Object.entries({articles:'[]',feeds:'[]',counter:'0',userPreferences:'{"theme":"glass"}',cache:'{"one":1}'}))originalRepo.write(key,value);
    original.close();
    const store=createSqliteDatabaseStore({root}),api=store.env.RSS_DATA;
    await api.get('cache',{type:'json'});await api.put('cache','{"one":2}');
    await api.get('counter');await api.get('userPreferences',{type:'json'});
    const upgrade=api.optimizeStorage();
    const saves=Array.from({length:20},()=>api.updateMany(['counter'],current=>({counter:String(current.counter+1)})));
    await Promise.all([upgrade,...saves]);assert.equal(await api.get('counter',{type:'json'}),20);
    await api.put('cache','{"one":3}');assert.deepEqual(await api.get('cache',{type:'json'}),{one:3});
    await api.put('userPreferences','{"theme":"classic"}');assert.equal((await api.get('userPreferences',{type:'json'})).theme,'classic');
    await store.close();
    const other=createSqliteDatabaseStore({root});await other.env.RSS_DATA.get('counter');
    const pending=other.env.RSS_DATA.optimizeStorage().catch(error=>error);
    await other.close();await pending;
    const db=openSqlite(path.join(root,'database_state/reader.sqlite'),{readOnly:true});
    try{assert.equal(createRepository(db).read('counter'),'20');}finally{db.close();}
});

test('row phase can run without the write-holding VACUUM, which completes later',async t=>{
    const root=await directory(t);await fs.writeFile(path.join(root,'database.json'),JSON.stringify({articles:'[]',feeds:'[]',userPreferences:'{"theme":"glass"}'}));
    const filename=path.join(root,'database_state/reader.sqlite');await fs.mkdir(path.dirname(filename));
    const original=new DatabaseSync(filename);original.exec(SCHEMA.replace(') STRICT, WITHOUT ROWID;',') STRICT;'));
    original.prepare('INSERT INTO storage_meta VALUES(?,?)').run('migration_complete','{}');
    const repo=createRepository(original);for(const [key,value]of Object.entries({articles:'[]',feeds:'[]',userPreferences:'{"theme":"glass"}'}))repo.write(key,value);
    original.close();
    const store=createSqliteDatabaseStore({root}),api=store.env.RSS_DATA;
    try{
        const rows=await api.optimizeStorage({compact:false});
        assert.equal(rows.rowsComplete,true);assert.notEqual(rows.complete,true);
        let db=openSqlite(filename,{readOnly:true});
        try{assert.equal(pragma(db,'auto_vacuum'),0);assert.doesNotMatch(db.prepare("SELECT sql FROM sqlite_schema WHERE name='metadata_entries'").get().sql,/WITHOUT ROWID/);}finally{db.close();}
        await api.put('userPreferences','{"theme":"classic"}');
        const done=await api.optimizeStorage();assert.equal(done.complete,true);assert.equal(done.backup,rows.backup);
        assert.equal((await api.get('userPreferences',{type:'json'})).theme,'classic');
        db=openSqlite(filename,{readOnly:true});try{assert.equal(pragma(db,'auto_vacuum'),2);}finally{db.close();}
    }finally{await store.close();}
});

// ---- Review fixes F1-F8 ----
async function seededRoot(t,values={articles:'[]',feeds:'[]',userPreferences:'{"theme":"glass"}'}){
    const root=await directory(t);await fs.writeFile(path.join(root,'database.json'),JSON.stringify(values));
    const filename=path.join(root,'database_state/reader.sqlite');await fs.mkdir(path.dirname(filename));
    const db=new DatabaseSync(filename);db.exec(SCHEMA);db.prepare('INSERT INTO storage_meta VALUES(?,?)').run('migration_complete','{}');
    const repo=createRepository(db);for(const [key,value]of Object.entries(values))repo.write(key,value);db.close();
    return {root,filename};
}

test('F1: a failing upgrade never stops the 6-hourly backup and maintenance',async t=>{
    const {root}=await seededRoot(t),store=createSqliteDatabaseStore({root}),api=store.env.RSS_DATA;
    const errors=[];const original=console.error;console.error=(...args)=>errors.push(args.join(' '));
    try{
        api.optimizeStorage=()=>Promise.reject(Error('injected upgrade failure'));
        await store.runMaintenance();
        const names=await fs.readdir(path.join(root,'database_state/sqlite-backups'));
        assert.ok(names.some(name=>name.endsWith('.manifest.json')),'backup published');
        assert.ok(errors.some(line=>line.includes('injected upgrade failure')));
        assert.ok(!errors.some(line=>line.includes('BACKUP STALE')));
    }finally{console.error=original;await store.close();}
});

test('F1: missing/corrupt recovery backup is recreated, orphans removed, referenced one kept (F7)',async t=>{
    const {root,filename}=await seededRoot(t),db=openSqlite(filename);
    const state=path.join(root,'database_state');
    try{
        // Orphans of an interrupted earlier attempt (file published, progress not saved).
        await fs.writeFile(path.join(state,'before-backend-storage-v2.sqlite'),'orphan');
        await fs.writeFile(path.join(state,'before-backend-storage-v2.sqlite-123.sqlite'),'orphan');
        await fs.writeFile(path.join(state,'before-backend-storage-v2.sqlite-123.sqlite.manifest.json'),'{}');
        const first=await prepareStorageUpgrade(db,root);
        assert.equal(first.backup,path.join(state,'before-backend-storage-v2.sqlite'));
        assert.deepEqual((await fs.readdir(state)).filter(name=>name.startsWith('before-')).sort(),['before-backend-storage-v2.sqlite','before-backend-storage-v2.sqlite.manifest.json']);
        assert.equal((await prepareStorageUpgrade(db,root)).backup,first.backup,'valid referenced backup is reused');
        await fs.appendFile(first.backup,'corruption');
        const errors=[];const original=console.error;console.error=(...args)=>errors.push(args.join(' '));
        let second;try{second=await prepareStorageUpgrade(db,root);}finally{console.error=original;}
        assert.ok(errors.some(line=>line.includes('missing or corrupt')));
        assert.deepEqual(second.invalidBackups,[first.backup]);
        const copy=openSqlite(second.backup,{readOnly:true});try{assert.equal(pragma(copy,'integrity_check'),'ok');}finally{copy.close();}
        assert.equal((await upgradeStorage(db,root)).complete,true);
    }finally{db.close();}
});

test('F2: a database already rebuilt WITHOUT ROWID by an earlier build still upgrades and works',async t=>{
    const {root,filename}=await seededRoot(t);
    let db=new DatabaseSync(filename);
    db.exec(`CREATE TABLE m2 (collection TEXT NOT NULL REFERENCES collections(name) ON DELETE CASCADE,row_key TEXT NOT NULL, position INTEGER NOT NULL, value TEXT NOT NULL, digest TEXT NOT NULL,PRIMARY KEY(collection,row_key)) STRICT, WITHOUT ROWID;
        INSERT INTO m2 SELECT * FROM metadata_entries;DROP TABLE metadata_entries;ALTER TABLE m2 RENAME TO metadata_entries;CREATE INDEX metadata_order ON metadata_entries(collection,position);`);
    db.close();db=openSqlite(filename);
    try{
        assert.equal((await upgradeStorage(db,root)).complete,true);
        const repo=createRepository(db);repo.patchMap('smartVerificationFailures',{a:{at:new Date().toISOString()}});
        assert.equal(repo.info('smartVerificationFailures').item_count,1);assert.equal(checkDatabase(db).integrity,'ok');
    }finally{db.close();}
});

test('F3: Google News mappings referenced by saved/Board/cache state are never evicted',async t=>{
    const root=await directory(t),db=openSqlite(path.join(root,'reader.sqlite'));
    try{
        const repo=createRepository(db),now=Date.now(),old=now-400*86400000;
        const g=id=>'https://news.google.com/rss/articles/'+id;
        repo.write('savedStates',JSON.stringify([g('saved')]));
        repo.write('boardStates',JSON.stringify(['https://publisher.example/board-story']));
        repo.write('cacheMembers',JSON.stringify({m:{url:g('member')}}));
        repo.write('cacheIdentityLedger',JSON.stringify({articles:{[g('ledger')]:{auto_added:false}},dismissals:{}}));
        const rows={saved:{resolvedUrl:'https://a/1',cachedAt:old},board:{resolvedUrl:'https://publisher.example/board-story',cachedAt:old},
            member:{resolvedUrl:'https://a/3',cachedAt:old},ledger:{resolvedUrl:'https://a/4',cachedAt:old},stale:{resolvedUrl:'https://a/5',cachedAt:old},
            failed:{resolvedUrl:'',cachedAt:old}};
        repo.patchMap('googleNewsUrlCache',Object.fromEntries(Object.entries(rows).map(([id,value])=>[g(id),value])));
        // The write path has no reference information and keeps every resolved row.
        assert.equal(repo.info('googleNewsUrlCache').item_count,5);
        db.exec('BEGIN');const report=pruneDerivedCaches(db,now);db.exec('COMMIT');
        assert.equal(report.googleNewsUrlCacheProtected,4);
        assert.deepEqual(Object.keys(JSON.parse(repo.read('googleNewsUrlCache'))).sort(),['board','ledger','member','saved'].map(g).sort());
        assert.equal(CACHE_RETENTION.googleNewsUrlCache.maxBytes,96*1024*1024);
    }finally{db.close();}
});

test('F4: maintenance and VACUUM phases run no integrity scan while writes are held',async t=>{
    const root=await directory(t),db=openSqlite(path.join(root,'reader.sqlite'));
    try{
        const seen=[];const prepare=db.prepare.bind(db),exec=db.exec.bind(db);
        db.prepare=sql=>{seen.push(sql);return prepare(sql);};db.exec=sql=>{seen.push(sql);return exec(sql);};
        maintainDatabase(db);
        assert.ok(!seen.some(sql=>/quick_check|integrity_check|foreign_key_check/.test(sql)));
        db.prepare=prepare;db.exec=exec;assert.equal(checkDatabase(db).integrity,'ok');
    }finally{db.close();}
});

test('F6: check and backup are read-only beside a running writer; migrate refuses',async t=>{
    const {root,filename}=await seededRoot(t);
    const { spawnSync }=await import('node:child_process');
    await fs.writeFile(path.join(root,'database.writer.lock'),JSON.stringify({pid:process.pid,startedAt:Date.now()}));
    const before=(await fs.stat(filename)).mtimeMs,script=path.resolve('ops/maintenance/sqlite-storage.mjs');
    const run=(...args)=>spawnSync(process.execPath,[script,...args],{encoding:'utf8',env:{...process.env,NODE_TEST_CONTEXT:''}});
    const check=run('check',root);assert.equal(check.status,0,check.stderr);assert.equal(JSON.parse(check.stdout).integrity,'ok');
    const backup=run('backup',path.join(root,'manual.sqlite'),root);assert.equal(backup.status,0,backup.stderr);
    assert.equal((await fs.stat(filename)).mtimeMs,before,'database file not written');
    const migrate=run('migrate',root);assert.notEqual(migrate.status,0);assert.match(migrate.stderr,/still running/);
});

test('F8: saturated card-image lookups are retryable 503s for HTTP, null for background callers',async()=>{
    const { createArticleImages }=await import('../src/articles/images.js');
    let release;const gate=new Promise(resolve=>{release=resolve;});
    const images=createArticleImages({getLastKnownCachedArticleImage:async()=>{await gate;return 'https://img/x.jpg';}});
    const inflight=Array.from({length:64},(_,i)=>images.getBestImage('https://site.example/'+i,null,null));
    await assert.rejects(images.getBestImage('https://site.example/busy',null,null,{throwWhenBusy:true}),error=>error.code==='WORK_QUEUE_FULL'&&error.status===503);
    assert.equal(await images.getBestImage('https://site.example/busy',null,null),null);
    release();await Promise.all(inflight);
});
