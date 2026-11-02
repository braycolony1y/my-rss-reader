// Self-contained scrolling repair. Never pulls Git, touches application data,
// reloads the service, or overwrites files with unrecognized content.
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {readFile,writeFile,mkdir,lstat,realpath,rename,unlink,chmod} from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {readerModalPayload} from './reader-modal-payload.mjs';
export const repairBundle=JSON.parse(gunzipSync(Buffer.from(readerModalPayload,'base64')));
const hash=value=>createHash('sha256').update(value).digest('hex');
async function readMaybe(file){try{return await readFile(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function safeTarget(root,relative){
 if(path.isAbsolute(relative)||relative.split(/[\\/]/).some(p=>!p||p==='.'||p==='..'))throw Error('Invalid repair path');
 const target=path.join(root,relative);
 let current=root;
 for(const part of relative.split('/')){
  current=path.join(current,part);
  try{if((await lstat(current)).isSymbolicLink())throw Error('Refusing symlink: '+current);}catch(error){if(error.code!=='ENOENT')throw error;}
 }
 return target;
}
export async function checkRepair(directory){
 const root=await realpath(directory),entries=[];
 for(const entry of repairBundle.files){
  if(hash(entry.after)!==entry.afterHash||(entry.before!==null&&hash(entry.before)!==entry.beforeHash))throw Error('Invalid embedded repair payload');
  const file=await safeTarget(root,entry.path),value=await readMaybe(file),current=value===null?null:hash(value);
  const state=current===entry.afterHash?'applied':current===entry.beforeHash?'pending':'conflict';
  entries.push({...entry,file,state,mode:value===null?0o644:(await lstat(file)).mode&0o777});
 }
 const conflicts=entries.filter(e=>e.state==='conflict');
 if(conflicts.length)throw Error('No files changed. Unrecognized local edits: '+conflicts.map(e=>e.path).join(', '));
 return {root,entries};
}
async function atomicWrite(file,value,mode){
 await mkdir(path.dirname(file),{recursive:true});
 const temporary=file+`.reader-modal-${process.pid}.tmp`;
 try{await writeFile(temporary,value,{mode,flag:'wx'});await chmod(temporary,mode);await rename(temporary,file);}
 finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
export async function applyRepair(directory){
 const {root,entries}=await checkRepair(directory),pending=entries.filter(e=>e.state==='pending');
 if(!pending.length)return {alreadyApplied:true,files:0};
 const backup=await safeTarget(root,'ops/backups/reader-modal-'+new Date().toISOString().replaceAll(':','-')+'-'+process.pid);
 await mkdir(backup,{recursive:true});
 const manifest={root,files:pending.map(({path,beforeHash,afterHash,mode})=>({path,beforeHash,afterHash,mode}))};
 // Save all original files and the rollback manifest before the first edit.
 for(const entry of pending)if(entry.before!==null){
  const destination=path.join(backup,entry.path);await mkdir(path.dirname(destination),{recursive:true});
  await writeFile(destination,await readFile(entry.file),{flag:'wx',mode:entry.mode});
 }
 await writeFile(path.join(backup,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx'});
 try{
  for(const entry of pending){
   const current=await readMaybe(entry.file);
   if((current===null?null:hash(current))!==entry.beforeHash)throw Error('File changed after preflight: '+entry.path);
   await atomicWrite(entry.file,entry.after,entry.mode);
  }
 }catch(error){throw Error(error.message+'; backup and rollback manifest: '+backup);}
 return {alreadyApplied:false,files:pending.length,backup,backendRestartRequired:pending.some(e=>e.path.startsWith('src/'))};
}
export async function rollbackRepair(directory){
 const backup=await realpath(directory),manifest=JSON.parse(await readFile(path.join(backup,'manifest.json'),'utf8'));
 const root=await realpath(manifest.root),pending=[];
 for(const entry of manifest.files){
  const known=repairBundle.files.find(e=>e.path===entry.path&&e.beforeHash===entry.beforeHash&&e.afterHash===entry.afterHash);
  if(!known)throw Error('Unrecognized rollback manifest');
  const file=await safeTarget(root,entry.path),current=await readMaybe(file),digest=current===null?null:hash(current);
  if(![entry.beforeHash,entry.afterHash].includes(digest))throw Error('No files restored. Later edits would be overwritten: '+entry.path);
  const original=entry.beforeHash===null?null:await readFile(await safeTarget(backup,entry.path));
  if((original===null?null:hash(original))!==entry.beforeHash)throw Error('Backup integrity failure: '+entry.path);
  pending.push({...entry,file,original});
 }
 // Restore the entry point before removing any newly introduced dependencies.
 for(const entry of pending.reverse()){
  if(entry.original===null)await unlink(entry.file).catch(error=>{if(error.code!=='ENOENT')throw error;});
  else await atomicWrite(entry.file,entry.original,entry.mode);
 }
 return {restored:pending.length,root};
}

export async function verifyRepair(directory, {run = spawnSync} = {}) {
 const {root,entries}=await checkRepair(directory);
 if(entries.some(entry=>entry.state!== 'applied')) throw Error('Verify requires the complete candidate; use --check for compatibility.');
 for(const entry of entries.filter(entry=>entry.path.endsWith('.js'))) {
  const check=run(process.execPath,['--check',entry.file],{cwd:root,encoding:'utf8'});
  if(check.error||check.status!==0) throw Error('Syntax check failed: '+entry.path+' '+(check.error?.message||check.stderr));
 }
 const tests=run(process.execPath,['--test','--test-reporter=tap','test/reader-modal.test.js','test/article-navigation.test.js','test/reading-state-sync.test.js','test/reader-assets.test.js','test/frontend-modules.test.js','test/voz-thread-state.test.js'],{cwd:root,encoding:'utf8',timeout:120000});
 const completed=tests.stdout?.match(/^# tests ([1-9]\d*)$/m);
 if(tests.error||tests.status!==0||!completed) throw Error('Regression verification failed: '+(tests.error?.message||'')+' '+tests.stdout+' '+tests.stderr);
 return {verified:true,syntaxFiles:entries.filter(entry=>entry.path.endsWith('.js')).length,regressions:tests.stdout};
}
