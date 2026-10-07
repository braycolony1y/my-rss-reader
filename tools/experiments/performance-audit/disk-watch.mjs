import {watch} from 'node:fs';
import {stat,writeFile,readdir} from 'node:fs/promises';
import path from 'node:path';
const root=process.argv[2]||'/home/ubuntu/my-rss-reader',seconds=Number(process.argv[3]||180),output=process.argv[4]||'/tmp/rss-audit-followup-20261007/disk-before.json';
const rows=[],seen=new Map(),pending=new Map(),watchers=[];
const watched=new Set();
async function watchDirectory(directory,recursive=false){
 if(watched.has(directory))return;
 watched.add(directory);
 try{if(!(await stat(directory)).isDirectory()){watched.delete(directory);return;}
 watchers.push(watch(directory,(event,name)=>{
  if(recursive&&name)void watchDirectory(path.join(directory,String(name)),true);
  if(!name||!String(name).endsWith('.json')||String(name).includes('.tmp'))return;
  const file=path.join(directory,String(name));clearTimeout(pending.get(file));
  pending.set(file,setTimeout(async()=>{pending.delete(file);try{const info=await stat(file),signature=`${info.ino}:${info.mtimeMs}:${info.size}`;if(seen.get(file)===signature)return;seen.set(file,signature);rows.push({at:Date.now(),file:path.relative(root,file),bytes:info.size});await writeFile(output,JSON.stringify(rows,null,2));}catch{}},40));
 }));
 if(recursive)for(const entry of await readdir(directory,{withFileTypes:true}))if(entry.isDirectory())await watchDirectory(path.join(directory,entry.name),true);
 }catch{watched.delete(directory);}
}
await watchDirectory(root);
await watchDirectory(path.join(root,'article_cache'),true);
// The keyed overlay's parts are essential to the write total, not just its manifest.
await watchDirectory(path.join(root,'database_state'),true);
const discover=setInterval(()=>void watchDirectory(path.join(root,'database_state'),true),1000);
await new Promise(resolve=>setTimeout(resolve,seconds*1000));clearInterval(discover);for(const watcher of watchers)watcher.close();
await new Promise(resolve=>setTimeout(resolve,100));
const totals={};for(const row of rows){const item=totals[row.file]||={count:0,bytes:0};item.count++;item.bytes+=row.bytes;}
await writeFile(output,JSON.stringify({seconds,rows,totals},null,2));console.log(JSON.stringify(Object.entries(totals).sort((a,b)=>b[1].bytes-a[1].bytes).slice(0,15)));
