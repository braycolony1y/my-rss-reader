import fs from 'node:fs/promises';
import WebSocket from 'ws';
const prefix = process.argv[2] || '/tmp/rss-profile';
const seconds = Number(process.argv[3] || 60);
if (!Number.isFinite(seconds) || seconds < 5 || seconds > 300) throw new RangeError('Profile duration must be 5–300 seconds');
const [target] = await (await fetch('http://127.0.0.1:9229/json/list')).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
let id = 0;
const calls = new Map();
ws.on('message', raw => { const message = JSON.parse(raw); if (!message.id) return; const call = calls.get(message.id); calls.delete(message.id); if (message.error) call.reject(message.error); else call.resolve(message.result); });
const send = (method, params = {}) => new Promise((resolve, reject) => { calls.set(++id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const memory = async () => (await send('Runtime.evaluate', { expression: 'JSON.stringify({at:Date.now(),pid:process.pid,uptime:process.uptime(),...process.memoryUsage(),cpu:process.cpuUsage()})', returnByValue:true })).result.value;
try {
 await send('Profiler.enable');
 await send('Profiler.setSamplingInterval', { interval: 2000 });
 await send('HeapProfiler.startSampling', { samplingInterval:262144, includeObjectsCollectedByMajorGC:true, includeObjectsCollectedByMinorGC:true });
 await send('Profiler.start');
 const samples = [];
 for (let i=0; i<seconds; i+=5) { samples.push(JSON.parse(await memory())); await new Promise(resolve=>setTimeout(resolve,5000)); }
 samples.push(JSON.parse(await memory()));
 const { profile } = await send('Profiler.stop');
 const allocation = (await send('HeapProfiler.stopSampling')).profile;
 await fs.writeFile(prefix+'.cpuprofile', JSON.stringify(profile));
 await fs.writeFile(prefix+'.heapprofile', JSON.stringify(allocation));
 await fs.writeFile(prefix+'-memory.json', JSON.stringify(samples,null,2));
 const nodes = new Map(profile.nodes.map(n=>[n.id,n]));
 const self = new Map(); const inclusive = new Map(); const parents=new Map();
 for(const n of profile.nodes) for(const c of n.children||[]) parents.set(c,n.id);
 for(let i=0;i<profile.samples.length;i++) { const node=profile.samples[i]; const dt=profile.timeDeltas[i]; self.set(node,(self.get(node)||0)+dt); const seen=new Set(); for(let p=node;p && !seen.has(p);p=parents.get(p)) { seen.add(p); inclusive.set(p,(inclusive.get(p)||0)+dt); } }
 const rows=table=>[...table].sort((a,b)=>b[1]-a[1]).slice(0,22).map(([id,us])=>({ms:Math.round(us/1000),fn:nodes.get(id).callFrame.functionName,url:nodes.get(id).callFrame.url,line:nodes.get(id).callFrame.lineNumber+1}));
 const alloc=[]; const walk=(n)=>{ if(n.selfSize) alloc.push({mb:+(n.selfSize/1048576).toFixed(1),...n.callFrame,line:n.callFrame.lineNumber+1}); for(const child of n.children) walk(child); };walk(allocation.head);
 console.log(JSON.stringify({samples,self:rows(self),inclusive:rows(inclusive),allocations:alloc.sort((a,b)=>b.mb-a.mb).slice(0,22)},null,2));
} finally { ws.close(); }
