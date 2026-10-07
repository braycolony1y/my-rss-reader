import WebSocket from 'ws';
import {writeFile} from 'node:fs/promises';
const [target]=await(await fetch('http://127.0.0.1:9229/json/list')).json();
const ws=new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});
let seq=0;const calls=new Map();
ws.on('message',data=>{const m=JSON.parse(data);if(m.id){const c=calls.get(m.id);calls.delete(m.id);m.error?c.reject(m.error):c.resolve(m.result);}});
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;calls.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
try {
 await send('HeapProfiler.startSampling',{samplingInterval:262144});
 const samples=[];
 for(let i=0;i<24;i++) {const res=await send('Runtime.evaluate',{expression:'JSON.stringify(process.memoryUsage())',returnByValue:true});samples.push(JSON.parse(res.result.value));await new Promise(r=>setTimeout(r,5000));}
 const {profile}=await send('HeapProfiler.stopSampling');const rows=[];
 const walk=(n,parents=[])=>{if(n.selfSize)rows.push({bytes:n.selfSize,frame:n.callFrame,parents:parents.slice(-4)});for(const child of n.children)walk(child,[...parents,n.callFrame.functionName]);};walk(profile.head);
 await writeFile(process.argv[2]||'/tmp/rss-audit-20261006/retention.json',JSON.stringify({samples,rows:rows.sort((a,b)=>b.bytes-a.bytes)},null,2));
} finally {
 if(process.argv.includes('--close-inspector'))await send('Runtime.evaluate',{expression:"setTimeout(() => process.getBuiltinModule('node:inspector').close(), 250); undefined"}).catch(()=>{});
 ws.close();
}
