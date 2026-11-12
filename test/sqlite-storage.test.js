import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createSqliteDatabaseStore } from '../src/database/sqlite/store.js';
import { fileHash } from '../src/database/sqlite/files.js';
import { rankingInputs, readRankingInputs } from '../src/articles/ranking-input.js';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { exportLegacyDatabase } from '../src/database/sqlite/export.js';
import { openSqlite } from '../src/database/sqlite/connection.js';
import { createCacheFilesystem, writeCacheJson } from '../src/database/cache-filesystem.js';
import { rollbackToJson } from '../src/database/sqlite/rollback.js';

async function fixture(t,snapshot={feeds:'[]',articles:'[]'}){
    const root=await fs.mkdtemp('/tmp/rss-sqlite-test-');
    await fs.writeFile(path.join(root,'database.json'),JSON.stringify(snapshot));
    const owners=[];
    const open=()=>{const owner=createSqliteDatabaseStore({root});owners.push(owner);return owner.env.RSS_DATA;};
    t.after(async()=>{for(const owner of owners)await owner.close();await fs.rm(root,{recursive:true,force:true});});
    return {root,open};
}

test('lossless migration, normalized membership, indexed lookup and untouched original JSON',async t=>{
    const rows=[{link:'https://x.test/a',relatedArticles:[{link:'https://x.test/b',id:9}],title:'Điện thoại 📚',id:7},
        {link:'https://x.test/a',id:8,title:'Different variant'},{title:'No URL',odd:{nested:[1,null]}}];
    const initial={feeds:'[{"url":"https://x.test/rss","title":"Feed"}]',articles:JSON.stringify(rows),
        readStates:'["https://x.test/a"]',boardStates:'["https://x.test/a"]',userPreferences:'{"theme":"glass"}',
        smartCandidateSignature:'opaque',smartProgressivePublication:'null',smartSourceScores:{one:2},nativeFlag:false};
    const {root,open}=await fixture(t,initial),before=await fileHash(path.join(root,'database.json')),db=open();
    for(const [key,value]of Object.entries(initial))assert.deepEqual(await db.get(key),value||null,key);
    assert.deepEqual(await db.findArticles('articles',{links:['https://x.test/a']}),rows.slice(0,2));
    assert.deepEqual(await db.get('articles',{type:'json'}),rows);
    const shared=await db.get('articles',{type:'json',shared:true});
    const mutable=await db.get('articles',{type:'json'});mutable[0].title='changed only locally';
    assert.equal(shared[0].title,rows[0].title);
    await db.put('articles',JSON.stringify(rows));
    assert.equal(await db.get('articles',{type:'json',shared:true}),shared);
    await db.put('userPreferences','{"theme":"classic","new":true}');
    assert.equal(await fileHash(path.join(root,'database.json')),before);
    const sqlite=new DatabaseSync(path.join(root,'database_state/reader.sqlite'),{readOnly:true});
    assert.equal(sqlite.prepare('SELECT count(*) n FROM cluster_members').get().n,1);
    assert.equal(sqlite.prepare('PRAGMA journal_mode').get().journal_mode,'wal');sqlite.close();
    assert.equal((await open().get('userPreferences',{type:'json'})).theme,'classic');
});

test('atomic updates serialize across connections and roll back all keys on errors',async t=>{
    const {open}=await fixture(t,{feeds:'[]',articles:'[]',counter:'0',savedStates:'[]'}),left=open();
    await left.get('counter');const right=open();await right.get('counter');
    await Promise.all(Array.from({length:24},(_,i)=>(i%2?left:right).updateMany(['counter'],current=>({counter:JSON.stringify(current.counter+1)}))));
    assert.equal(await left.get('counter',{type:'json'}),24);
    await assert.rejects(left.updateMany(['counter'],async()=>({counter:'0'})),/synchronous/);
    await assert.rejects(left.updateMany(['counter'],()=>({other:'0'})),/undeclared/);
    await assert.rejects(left.putMany({counter:'0',articles:'not json'}),/valid array/);
    assert.equal(await right.get('counter',{type:'json'}),24);
    await assert.rejects(left.updateMany(['counter'],()=>{throw Error('callback failed');}),/callback failed/);
    assert.equal(await left.get('counter',{type:'json'}),24);
});

test('rank fingerprints are cheap, revision pinned and detect changes before materialization',async t=>{
    const {open}=await fixture(t,{feeds:'[]',articles:'[]',smartClusters:'[{"link":"a"}]',smartRawArticles:'[]'}),db=open();
    const clusters=await db.get('smartClusters',{fingerprint:true}),raw=await db.get('smartRawArticles',{fingerprint:true});
    const inputs=rankingInputs(clusters,raw);
    assert.deepEqual(await readRankingInputs(inputs),{publicationJson:'[{"link":"a"}]',rawJson:'[]'});
    await db.put('smartClusters','[{"link":"b"}]');
    await assert.rejects(clusters.readAsync(),{code:'SQLITE_SNAPSHOT_CHANGED'});
    assert.notEqual((await db.get('smartClusters',{fingerprint:true})).digest,clusters.digest);
});

test('overlay replay, split Smart data, backups and restoration preserve the final state',async t=>{
    const {root,open}=await fixture(t,{feeds:'[]',articles:'[]',readStates:'["old"]',__stateRevision:3});
    await fs.writeFile(path.join(root,'smart-data.json'),JSON.stringify({smartClusters:'[{"link":"smart"}]',__smartStateRevision:2}));
    await fs.mkdir(path.join(root,'database_state/database-state.json'),{recursive:true});
    await fs.writeFile(path.join(root,'database_state/database-state.json/5.readStates.json'),JSON.stringify({value:'["new"]'}));
    await fs.writeFile(path.join(root,'database-state.json'),JSON.stringify({format:'rss-keyed-overlay-v1',revision:5,files:{readStates:'5.readStates.json'}}));
    await fs.writeFile(path.join(root,'smart-state.json'),JSON.stringify({revision:4,values:{smartClusterVersion:'new-version'}}));
    const db=open();assert.deepEqual(await db.get('readStates',{type:'json'}),['new']);
    assert.equal(await db.get('smartClusterVersion'),'new-version');
    await db.put('savedStates','["after-cutover"]');
    const backup=await db.backup({});
    const restoredRoot=await fs.mkdtemp('/tmp/rss-sqlite-restore-');
    t.after(()=>fs.rm(restoredRoot,{recursive:true,force:true}));
    await fs.mkdir(path.join(restoredRoot,'database_state'));
    await fs.copyFile(backup.filename,path.join(restoredRoot,'database_state/reader.sqlite'));
    const restored=createSqliteDatabaseStore({root:restoredRoot});t.after(()=>restored.close());
    assert.deepEqual(await restored.env.RSS_DATA.get('savedStates',{type:'json'}),['after-cutover']);
    assert.deepEqual(await restored.env.RSS_DATA.get('readStates',{type:'json'}),['new']);
    assert.equal((await restored.env.RSS_DATA.get('smartClusters',{type:'json'}))[0].link,'smart');
    const report=await db.maintenance();assert.equal(report.integrity,'ok');
});

test('normalized published rankings preserve envelopes and incremental record updates',async t=>{
    const {root,open}=await fixture(t),db=open();
    const publication={version:2,articles:[{link:'https://a.test',clusterId:'c1',topStory:{feed:'news_vietnam',rank:1,isTop:true},ranking:{score:42}}],trailer:{unknown:true}};
    await db.put('topStoriesPublished',JSON.stringify(publication));
    assert.deepEqual(await db.get('topStoriesPublished',{type:'json'}),publication);
    const sqlite=new DatabaseSync(path.join(root,'database_state/reader.sqlite'),{readOnly:true});
    assert.equal(sqlite.prepare('SELECT count(*) n FROM rankings').get().n,1);
    assert.equal(sqlite.prepare("SELECT count(*) n FROM articles WHERE collection='$topStoriesPublished.articles'").get().n,1);sqlite.close();
    const before=await db.get('topStoriesPublished',{fingerprint:true});publication.articles[0].ranking.score=43;
    await db.put('topStoriesPublished',JSON.stringify(publication));
    assert.notEqual((await db.get('topStoriesPublished',{fingerprint:true})).digest,before.digest);
    assert.deepEqual(await db.get('topStoriesPublished',{type:'json'}),publication);
});

test('entry updates preserve unrelated cache rows and invalidate shared reads across connections',async t=>{
    const {open}=await fixture(t,{feeds:'[]',articles:'[]',cache:'{"a":{"n":1},"b":2}'}),db=open();
    await db.get('cache',{type:'json',shared:true});const other=open();await other.get('feeds');
    await other.patchEntries('cache',{a:{n:3},c:4},['b']);
    assert.deepEqual(await db.getEntries('cache',['a','b','c']),{a:{n:3},c:4});
    assert.deepEqual(await db.get('cache',{type:'json',shared:true}),{a:{n:3},c:4});
    await assert.rejects(db.updateMany(['articles'],()=>({articles:'[]'}),{readProjections:{articles:'links'}}),/projected/);
});

test('migration preserves opaque JSON-like strings, native Unicode and surrogate boundaries',async t=>{
    const native={text:'prefix\ud800suffix',key:'Giữ 📚'},raw='prefix\ud800suffix';
    const {open}=await fixture(t,{feeds:'[]',articles:'[]',native,raw,opaque:'{not JSON',arrayLike:'[not JSON'}),db=open();
    assert.equal(await db.get('raw'),raw);assert.deepEqual(await db.get('native'),native);
    assert.equal(await db.get('opaque'),'{not JSON');assert.equal(await db.get('arrayLike'),'[not JSON');
});

test('WAL recovers committed changes and discards interrupted transactions; rollback export restores latest values',async t=>{
    const {root,open}=await fixture(t,{feeds:'[]',articles:'[]',counter:'1'}),db=open();await db.get('counter');
    for(const action of ['commit','uncommitted']){
        const child=spawn(process.execPath,[fileURLToPath(new URL('./helpers/sqlite-crash.js',import.meta.url)),path.join(root,'database_state/reader.sqlite'),action],{stdio:['ignore','pipe','pipe']});
        let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);
        await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error(stderr||'crash helper exited early');})]);
        const exit=once(child,'exit');child.kill('SIGKILL');await exit;
        assert.equal(await db.get('counter'),action==='commit'?'999':'44');
        if(action==='commit')await db.put('counter','44');
        else assert.equal(await db.get('counter'),'44');
    }
    const directory=path.join(root,'export'),sqlite=openSqlite(path.join(root,'database_state/reader.sqlite'),{readOnly:true});
    try{await exportLegacyDatabase(sqlite,directory);}finally{sqlite.close();}
    const restored=createSqliteDatabaseStore({root:directory});t.after(()=>restored.close());
    assert.equal(await restored.env.RSS_DATA.get('counter'),'44');
});

test('article and thread JSON caches move into SQLite while original files remain unchanged',async t=>{
    const {root,open}=await fixture(t);
    const directory=path.join(root,'article_cache');await fs.mkdir(path.join(directory,'threads'),{recursive:true});
    const file=path.join(directory,'sample.json'),original=JSON.stringify({version:62,cachedAt:123,url:'https://a.test',result:{content:'<p>Original</p>'}});
    await fs.writeFile(file,original);const db=open();await db.get('feeds');
    const virtual=createCacheFilesystem(db,{root});
    assert.equal(await virtual.readFile(file,'utf8'),original);
    const updated={version:62,cachedAt:456,url:'https://a.test',result:{content:'<p>Updated</p>'}};
    await writeCacheJson(db,file,updated,()=>{throw Error('Unexpected JSON file write');},{root});
    assert.equal(await fs.readFile(file,'utf8'),original);
    assert.deepEqual(JSON.parse(await virtual.readFile(file,'utf8')),updated);
    assert.equal((await db.cacheList('article_cache/'))[0].cached_at,456);
    await virtual.unlink(file);await assert.rejects(virtual.readFile(file,'utf8'),{code:'ENOENT'});
    assert.equal((await virtual.readdir(directory)).includes('sample.json'),false);
    assert.equal(await fs.readFile(file,'utf8'),original);
    const folder=path.join(directory,'pdf','b'.repeat(64));await fs.mkdir(folder,{recursive:true});
    await db.cachePut('article_cache/pdf/'+'b'.repeat(64)+'/job.json','{"id":"old","status":"ready"}');
    await virtual.rm(folder,{recursive:true,force:true});
    assert.equal(await db.cacheGet('article_cache/pdf/'+'b'.repeat(64)+'/job.json'),null);
});

test('Board archives update individual posts, preserve snapshots and support verified rollback',async t=>{
    const {root,open}=await fixture(t),db=open();await db.get('feeds');
    const relative='article_cache/threads/'+ 'a'.repeat(64)+'.json';
    const archive={thread_id:'thread:1',posts:{one:{post_id:'one',current_content:'Original'},two:{post_id:'two',current_content:'Keep'}},legacy_snapshots:[{content:'old',captured_at:'2026-01-01'}]};
    await db.cachePut(relative,JSON.stringify(archive));
    const sql=new DatabaseSync(path.join(root,'database_state/reader.sqlite'));
    sql.exec('CREATE TABLE test_post_updates(n INTEGER); INSERT INTO test_post_updates VALUES(0); CREATE TRIGGER test_changed_post AFTER UPDATE ON archive_entries BEGIN UPDATE test_post_updates SET n=n+1; END;');
    archive.posts.one.current_content='Updated';await db.cachePut(relative,JSON.stringify(archive));
    assert.equal(sql.prepare('SELECT n FROM test_post_updates').get().n,1);
    assert.equal(sql.prepare('SELECT count(*) n FROM archive_entries').get().n,3);
    assert.deepEqual(JSON.parse((await db.cacheGet(relative)).json),archive);sql.close();
    await db.put('savedStates','["latest"]');
    const result=await rollbackToJson(root);assert.equal(result.verified,true);
    assert.deepEqual(JSON.parse(JSON.parse(await fs.readFile(path.join(root,'database.json'),'utf8')).savedStates),['latest']);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(root,relative),'utf8')),archive);
    assert.equal(JSON.parse(await fs.readFile(path.join(root,'database_state/backend.json'),'utf8')).backend,'json');
});
