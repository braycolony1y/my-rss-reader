// One diagnostic collection, never a production memory-management policy.
import WebSocket from 'ws';
import {writeFile} from 'node:fs/promises';
const [target]=await(await fetch('http://127.0.0.1:9229/json/list')).json();
const ws=new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});
let sequence=0;const pending=new Map();
ws.on('message',data=>{const m=JSON.parse(data);if(m.id){const c=pending.get(m.id);pending.delete(m.id);m.error?c.reject(m.error):c.resolve(m.result);}});
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
const memory=async()=>JSON.parse((await send('Runtime.evaluate',{expression:'JSON.stringify(process.memoryUsage())',returnByValue:true})).result.value);
try{const before=await memory();const start=Date.now();await send('HeapProfiler.collectGarbage');const after=await memory();const result={before,after,durationMs:Date.now()-start};await writeFile('/tmp/rss-audit-20261006/gc-diagnostic.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));}finally{ws.close();}
