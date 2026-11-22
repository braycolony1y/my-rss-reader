// Read-only summary. Deduplicate the one-minute resource samples, keep process
// generations separate, and never interpret an idle candidate as proven idle.
import {readFile,writeFile} from 'node:fs/promises';
const [input,output]=process.argv.slice(2);
const records=(await readFile(input,'utf8')).trim().split('\n').flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
const valid=records.filter(r=>r.resources?.at&&r.resources.pid===r.pid&&r.resources.heapUsed);
const samples=[...new Map(valid.map(r=>[r.pid+':'+r.resources.at,r])).values()];
const stats=values=>{
 const a=values.filter(Number.isFinite).sort((a,b)=>a-b),n=a.length;
 return n?{median:(a[Math.floor((n-1)/2)]+a[Math.floor(n/2)])/2,p75:a[Math.ceil(n*.75)-1],p95:a[Math.ceil(n*.95)-1],max:a[n-1]}:null;
};
const groups=new Map();for(const r of valid){if(!groups.has(r.pid))groups.set(r.pid,[]);groups.get(r.pid).push(r);}
const result={records:records.length,completeResourceRecords:valid.length,uniqueResourceSamples:samples.length,
 hours:(records.at(-1).at-records[0].at)/3600000,
 processGenerations:groups.size,segments:[],
 observedIdleCandidates:samples.filter(r=>r.observedIdleCandidate).map(r=>({at:r.at,pid:r.pid,heapMiB:r.resources.heapUsed/1048576,smart:r.smart,gc:r.resources.gc,lastSyncCompletedAt:r.resources.lastSyncCompletedAt})),
 completions:valid.filter(r=>r.boundary?.smartCompletionChanged).map(r=>({at:r.at,pid:r.pid,heapMiB:r.resources.heapUsed/1048576,smart:r.smart,idleCandidate:r.observedIdleCandidate})),
 rssCompletionMarkers:valid.filter(r=>r.boundary?.rssCompleted).length};
for(const [pid,rows] of groups){
 const selected=samples.filter(r=>r.pid===pid),hours=(rows.at(-1).at-rows[0].at)/3600000;
 const physicalGiB=(rows.at(-1).io.write_bytes-rows[0].io.write_bytes)/2**30;
 result.segments.push({pid,hours,physicalGiB,physicalGiBPerHour:physicalGiB/hours,
  memoryMiB:Object.fromEntries(['heapUsed','heapTotal','rss','external','arrayBuffers'].map(k=>[k,stats(selected.map(r=>r.resources[k]/1048576))])),
  cpuPercent:stats(selected.map(r=>r.resources.cpuPercent)),
  eventLoopIntervalP95Ms:stats(selected.map(r=>r.resources.eventLoop?.p95Ms)),
  eventLoopMaxMs:stats(selected.map(r=>r.resources.eventLoop?.maxMs)),
  cgroupSwapMiB:stats(selected.map(r=>r.resources.budget?.swap/1048576))});
}
await writeFile(output,JSON.stringify(result,null,2));
console.log(JSON.stringify({records:result.records,samples:samples.length,processGenerations:groups.size,hours:result.hours,idleCandidates:result.observedIdleCandidates.length,smartCompletions:result.completions.length}));
