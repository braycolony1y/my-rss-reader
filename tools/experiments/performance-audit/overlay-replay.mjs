import fs from 'node:fs/promises';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {createKeyedOverlay} from '../../../src/database/keyed-overlay.js';
import {writeJsonSnapshot} from '../../../src/database/json-writer.js';
import {encodeStoredValue,decodeStoredValue} from '../../../src/database/stored-value.js';
const source=JSON.parse(await fs.readFile('/tmp/rss-audit-followup-20261007/frozen-state/database.json','utf8'));
const ledger=encodeStoredValue(source.cacheIdentityLedger);delete source.cacheIdentityLedger;
const reports=[];
for(const variant of ['legacy','keyed']){
 const directory=await fs.mkdtemp('/tmp/overlay-replay-'),filename=path.join(directory,'database-state.json');let bytes=0,writes=0;
 const atomic=async(file,data)=>{await writeJsonSnapshot(file+'.tmp',data);const info=await fs.stat(file+'.tmp');bytes+=info.size;writes++;await fs.rename(file+'.tmp',file);};
 const overlay=createKeyedOverlay({filename,allowedKeys:new Set(['cacheIdentityLedger','userPreferences','readStates']),writeJson:atomic});
 const values={cacheIdentityLedger:ledger,userPreferences:'{"theme":"glass-light"}',readStates:'[]'};const samples=[],cpu=process.cpuUsage();
 for(let step=0;step<13;step++){
  const changedKeys=step?['readStates']:Object.keys(values);values.readStates=JSON.stringify(Array.from({length:step*10},(_,i)=>'https://example.test/read/'+i));
  const start=performance.now();if(variant==='legacy')await atomic(filename,{revision:step+1,values});else await overlay.write({revision:step+1,values,changedKeys});samples.push(performance.now()-start);
 }
 const restored=variant==='legacy'?JSON.parse(await fs.readFile(filename,'utf8')):await overlay.load();
 if(restored.values.cacheIdentityLedger!==decodeStoredValue(ledger)||restored.values.readStates!==values.readStates)throw Error('Persistence replay mismatch');
 reports.push({variant,bytes,writes,cpu:process.cpuUsage(cpu),samples});await fs.rm(directory,{recursive:true,force:true});
}
await fs.writeFile('/tmp/rss-audit-followup-20261007/overlay-replay.json',JSON.stringify(reports,null,2));console.log(JSON.stringify(reports));
