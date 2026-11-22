// Bounded timing-only profile; closes the temporary loopback inspector.
import WebSocket from 'ws';
import {writeFile} from 'node:fs/promises';
const [target]=await(await fetch('http://127.0.0.1:9229/json/list')).json();
const ws=new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
let seq=0;const calls=new Map();
ws.on('message',data=>{const m=JSON.parse(data);if(m.id){const c=calls.get(m.id);calls.delete(m.id);m.error?c.reject(m.error):c.resolve(m.result);}});
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;calls.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
try {
 await send('Profiler.enable');await send('Profiler.start');
 await new Promise(resolve=>setTimeout(resolve,30000));
 const {profile}=await send('Profiler.stop');await writeFile(process.argv[2],JSON.stringify(profile));
}finally{
 await send('Runtime.evaluate',{expression:"setTimeout(() => process.getBuiltinModule('node:inspector').close(), 250); undefined"}).catch(()=>{});
 ws.close();
}
