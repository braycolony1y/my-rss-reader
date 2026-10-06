import {performance} from 'node:perf_hooks';
import inspector from 'node:inspector';
import {createHash} from 'node:crypto';
import {areaLabGrid,normalizeAmbient} from '../../public/card-blend/color.js';
import {normalizeMelt} from '../../src/images/card-blend/melt.js';
const w=1600,h=900; const pixels=Buffer.alloc(w*h*3);
for(let i=0;i<pixels.length;i++) pixels[i]=(i*37+(i>>8)*19)%256;
const session=new inspector.Session();session.connect();
const post=(method,params={})=>new Promise((res,rej)=>session.post(method,params,(e,v)=>e?rej(e):res(v)));
global.gc?.(); await post('HeapProfiler.startSampling',{samplingInterval:32768,includeObjectsCollectedByMajorGC:true,includeObjectsCollectedByMinorGC:true});
const start=performance.now(), cpu=process.cpuUsage(); let result,melt;
for(let repeat=0;repeat<2;repeat++) { result=normalizeAmbient(areaLabGrid(pixels,w,h));melt=normalizeMelt(pixels.subarray(0,320*180*3),320,180,result.cells); }
const ms=performance.now()-start;const usage=process.cpuUsage(cpu);const {profile}=await post('HeapProfiler.stopSampling');let allocated=0;
const walk=n=>{allocated+=n.selfSize;for(const c of n.children)walk(c)};walk(profile.head);session.disconnect();
console.log(JSON.stringify({ms:Math.round(ms),cpuMs:(usage.user+usage.system)/1000,allocatedMiB:allocated/1048576,maxRssMiB:process.resourceUsage().maxRSS/1024,hash:createHash('sha256').update(JSON.stringify(result)).update(melt).digest('hex')}));
