import {readFile,writeFile,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const output=process.argv[2]||'/tmp/rss-audit-20261006/resources-after.json',seconds=Number(process.argv[3]||180);
const read=async f=>{try{return await readFile(f,'utf8');}catch{return '';}};
const samples=[];
for(let elapsed=0;elapsed<=seconds;elapsed+=10){
 const pid=Number(execFileSync('systemctl',['show','rss-reader','-p','MainPID','--value'],{encoding:'utf8'}).trim());
 const rows=execFileSync('ps',['-eo','pid,ppid,comm,rss'],{encoding:'utf8'}).trim().split('\n').slice(1).map(l=>l.trim().split(/\s+/));
 const chromium=rows.filter(r=>/^(chrome|chromium)/.test(r[2]));
 let resources;try{resources=await(await fetch('http://127.0.0.1:3000/api/resources',{headers:{Cookie:'auth=true'},signal:AbortSignal.timeout(5000)})).json();}catch(e){resources={error:e.message};}
 const fields=Object.fromEntries((await read(`/proc/${pid}/io`)).trim().split('\n').filter(Boolean).map(l=>l.split(/:\s*/)));
 const stat=(await read(`/proc/${pid}/stat`)).split(') ')[1]?.split(' ');
 const status=await read(`/proc/${pid}/status`);
 samples.push({at:Date.now(),pid,rssKiB:Number(status.match(/VmRSS:\s*(\d+)/)?.[1]),swapKiB:Number(status.match(/VmSwap:\s*(\d+)/)?.[1]),cpuTicks:stat?Number(stat[11])+Number(stat[12]):null,io:Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,Number(v)])),chromium:{count:chromium.length,rssKiB:chromium.reduce((n,r)=>n+Number(r[3]),0),scope:'whole shared desktop browser, not reader-owned pages'},load:(await read('/proc/loadavg')).trim(),hostNetwork:(await read('/proc/net/dev')).trim(),resources});
 await writeFile(output,JSON.stringify(samples,null,2));if(elapsed<seconds)await new Promise(r=>setTimeout(r,10000));
}
console.log(JSON.stringify({samples:samples.length,pids:[...new Set(samples.map(s=>s.pid))],rssMiB:samples.map(s=>Math.round(s.rssKiB/1024)),swapMiB:samples.map(s=>Math.round(s.swapKiB/1024))}));
