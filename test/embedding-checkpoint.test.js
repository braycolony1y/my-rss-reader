import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createEmbeddingCheckpoint} from '../src/smart/embeddings/checkpoint.js';
import {mergeEmbeddingCache} from '../src/smart/embeddings/disk-cache.js';
test('unchanged worker checkpoints write nothing; changed vectors commit once and preserve history',{timeout:3000},async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rss-checkpoint-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const file=path.join(dir,'vectors.json');
 await fs.writeFile(file,JSON.stringify({old:'AA==',needed:'AQ=='}));const cache={};let writes=0,fail=false;
 const checkpoint=createEmbeddingCheckpoint({filename:file,importEntries:entries=>Object.assign(cache,entries),exportEntries:()=>cache,merge:async(...args)=>{writes++;if(fail)throw Error('disk failure');return mergeEmbeddingCache(...args);}});
 await checkpoint.load(new Set(['needed']));const inode=(await fs.stat(file)).ino;
 for(let i=0;i<5;i++)assert.equal(await checkpoint.save(),2);
 assert.equal(writes,0);assert.equal((await fs.stat(file)).ino,inode);
 cache.added='Ag==';fail=true;await assert.rejects(checkpoint.save(),/disk failure/);assert.equal(JSON.parse(await fs.readFile(file)).added,undefined);
 fail=false;assert.equal(await checkpoint.save(),3);assert.equal(writes,2);await checkpoint.save();assert.equal(writes,2);
 assert.deepEqual(JSON.parse(await fs.readFile(file)),{old:'AA==',needed:'AQ==',added:'Ag=='});
});
