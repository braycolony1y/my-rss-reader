import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {encodeStoredValue,decodeStoredValue,isStoredJson,sameStoredValue} from '../src/database/stored-value.js';
import {createParsedCache} from '../src/database/parsed-cache.js';
import {writeJsonSnapshot} from '../src/database/json-writer.js';
import {createDatabaseStore} from '../src/database/store.js';

test('UTF-8 ownership preserves serialized values, cache identity and the legacy durable format',async t=>{
 const raw=JSON.stringify({text:'Vietnam: điện thoại 📚 '.repeat(18000),literal:'\\uD800',newline:'\n'}),encoded=encodeStoredValue(raw);
 assert.ok(isStoredJson(encoded));assert.equal(decodeStoredValue(encoded),raw);assert.ok(sameStoredValue(encoded,encodeStoredValue(raw)));
 const lone='a'.repeat(300000)+'\ud800';assert.equal(encodeStoredValue(lone),lone,'non-well-formed raw strings remain lossless');
 const cache=createParsedCache({maxBytes:raw.length*2+100});const parsed=JSON.parse(raw);cache.set('test',encoded,parsed);
 assert.equal(cache.get('test',encoded).parsed,parsed);assert.equal(cache.state().estimatedSourceBytes,raw.length*2);
 const directory=await mkdtemp(path.join(tmpdir(),'stored-value-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const file=path.join(directory,'snapshot.json');await writeJsonSnapshot(file,{test:encoded});assert.deepEqual(JSON.parse(await readFile(file,'utf8')),{test:raw});
});

test('large database values preserve raw/JSON reads, isolation, unchanged writes and restart recovery',{timeout:15000},async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'stored-database-')),previous=process.cwd();process.chdir(directory);
 try{
  await writeFile('database.json',JSON.stringify({articles:'[]',feeds:'[]'}));const db=createDatabaseStore().env.RSS_DATA;
  const initial=JSON.stringify([{link:'https://example.test/a',title:'Large fixture',content:'Giữ nội dung 📚 '.repeat(30000)}]);
  await db.put('articles',initial);assert.equal(await db.get('articles'),initial);
  const shared=await db.get('articles',{type:'json',shared:true}),mutable=await db.get('articles',{type:'json'});mutable[0].title='local only';
  assert.equal(shared[0].title,'Large fixture');await db.put('articles',initial);assert.equal(await db.get('articles',{type:'json',shared:true}),shared);
  const next=JSON.stringify([{...shared[0],title:'Updated fixture'}]);await db.putMany({articles:next,readStates:JSON.stringify(['https://example.test/a'])});
  assert.notEqual(await db.get('articles',{type:'json',shared:true}),shared);
  const restored=createDatabaseStore().env.RSS_DATA;assert.equal(await restored.get('articles'),next);assert.deepEqual(await restored.get('readStates',{type:'json'}),['https://example.test/a']);
  await assert.rejects(db.put('articles','[]'),/Refusing to wipe/);assert.equal(await db.get('articles'),next);
 }finally{process.chdir(previous);await rm(directory,{recursive:true,force:true});}
});
