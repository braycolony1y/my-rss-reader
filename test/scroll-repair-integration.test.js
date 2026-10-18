import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,access} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {repairBundle,checkRepair,applyRepair,rollbackRepair} from '../ops/maintenance/apply-scroll-repair.mjs';
async function fixture(){
 const root=await mkdtemp(path.join(os.tmpdir(),'rss-scroll-repair-'));
 for(const entry of repairBundle.files)if(entry.before!==null){const file=path.join(root,entry.path);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,entry.before);}
 await writeFile(path.join(root,'database.json'),'user data sentinel');return root;
}
test('production repair checks hashes, preserves local data, is idempotent, and rolls back added files',async()=>{
 const root=await fixture();
 try{
  assert.ok((await checkRepair(root)).entries.every(e=>e.state==='pending'));
  const result=await applyRepair(root);assert.equal(result.files,repairBundle.files.length);
  assert.ok((await checkRepair(root)).entries.every(e=>e.state==='applied'));
  assert.deepEqual(await applyRepair(root),{alreadyApplied:true,files:0});
  assert.equal(await readFile(path.join(root,'database.json'),'utf8'),'user data sentinel');
  await rollbackRepair(result.backup);await rollbackRepair(result.backup);
  for(const entry of repairBundle.files){
   if(entry.before===null)await assert.rejects(access(path.join(root,entry.path)));
   else assert.equal(await readFile(path.join(root,entry.path),'utf8'),entry.before);
  }
 }finally{await rm(root,{recursive:true,force:true});}
});
test('unknown edits abort before any integration or rollback writes',async()=>{
 const root=await fixture();
 try{
  const entry=repairBundle.files[0],file=path.join(root,entry.path);
  await writeFile(file,'new user edit');
  await assert.rejects(applyRepair(root),/Unrecognized local edits/);
  assert.equal(await readFile(path.join(root,repairBundle.files[1].path),'utf8'),repairBundle.files[1].before);
  await writeFile(file,entry.before);
  const applied=await applyRepair(root);
  await writeFile(file,'later user edit');
  await assert.rejects(rollbackRepair(applied.backup),/Later edits would be overwritten/);
  assert.equal(await readFile(path.join(root,repairBundle.files[1].path),'utf8'),repairBundle.files[1].after);
 }finally{await rm(root,{recursive:true,force:true});}
});
