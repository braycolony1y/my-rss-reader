import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createKeyedOverlay} from '../src/database/keyed-overlay.js';
import {exportLegacyOverlay} from '../src/database/overlay-export.js';
import {writeJsonSnapshot} from '../src/database/json-writer.js';

test('overlay migration, incremental writes, failed batch commits and offline rollback preserve all values',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'keyed-overlay-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const filename=path.join(directory,'state.json'),allowedKeys=new Set(['ledger','readStates','preferences']);let failCommit=false;const writes=[];
 const writeJson=async(file,value)=>{if(file===filename&&failCommit)throw Error('simulated manifest failure');await writeJsonSnapshot(file+'.tmp',value);await fs.rename(file+'.tmp',file);writes.push({file,bytes:(await fs.stat(file)).size});};
 const values={ledger:JSON.stringify({history:'preserved'.repeat(50000)}),readStates:'[]',preferences:'{"theme":"classic"}'};
 await writeJson(filename,{revision:1,values});const overlay=createKeyedOverlay({filename,allowedKeys,writeJson});assert.deepEqual((await overlay.load()).values,values);
 await overlay.write({revision:2,values,changedKeys:['readStates']});const initial=JSON.parse(await fs.readFile(filename,'utf8'));
 const ledgerFile=path.join(directory,'database_state','state.json',initial.files.ledger),ledgerStat=await fs.stat(ledgerFile);
 writes.length=0;const changed={...values,readStates:'["article-a"]',preferences:'{"theme":"glass-light"}'};
 failCommit=true;await assert.rejects(overlay.write({revision:3,values:changed,changedKeys:['readStates','preferences']}),/manifest failure/);
 const recovered=createKeyedOverlay({filename,allowedKeys,writeJson});assert.deepEqual((await recovered.load()).values,values,'failed commit must expose neither new key');
 failCommit=false;await recovered.write({revision:3,values:changed,changedKeys:['readStates','preferences']});
 assert.deepEqual((await createKeyedOverlay({filename,allowedKeys,writeJson}).load()).values,changed);
 assert.equal((await fs.stat(ledgerFile)).ino,ledgerStat.ino,'unchanged history is not rewritten');
 assert.ok(writes.every(entry=>entry.file!==ledgerFile));
 assert.ok(await exportLegacyOverlay(filename));assert.deepEqual(JSON.parse(await fs.readFile(filename,'utf8')),{revision:3,values:changed});
});

test('stale manifests never read retired parts and manifest paths cannot escape the state directory',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'overlay-stale-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));const filename=path.join(directory,'state.json');
 const overlay=createKeyedOverlay({filename,allowedKeys:new Set(['history'])});
 await fs.writeFile(filename,JSON.stringify({format:'rss-keyed-overlay-v1',revision:4,files:{history:'4.history.json'}}));
 assert.deepEqual(await overlay.load(4),{revision:4,values:{}});await assert.rejects(overlay.load(),{code:'ENOENT'});
 await fs.writeFile(filename,JSON.stringify({format:'rss-keyed-overlay-v1',revision:5,files:{history:'../../private.json'}}));await assert.rejects(overlay.load(),/Invalid overlay/);
});

test('database mutex releases failed operations and reports queued ownership without retaining completed work',async()=>{
 const {createDatabaseTransactionQueue}=await import('../src/database/transaction-queue.js');
 const queue=createDatabaseTransactionQueue();let release;const gate=new Promise(resolve=>{release=resolve;});const order=[];
 const first=queue.run(async()=>{order.push(1);await gate;throw Error('expected failure');},{keys:['ledger'],bytes:300});
 const second=queue.run(()=>{order.push(2);return 'committed';},{keys:['readStates'],bytes:20});
 const rejected=assert.rejects(first,/expected failure/);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(queue.state().pendingBytes,20);assert.deepEqual(queue.state().active.keys,['ledger']);release();await rejected;assert.equal(await second,'committed');assert.deepEqual(order,[1,2]);
 assert.equal(queue.state().pendingBytes,0);assert.equal(queue.state().pending,0);assert.equal(queue.state().active,null);
});
