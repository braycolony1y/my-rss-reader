// Read-only isolated load of current snapshots and keyed overlays. Never opens
// the production DB writer; GC is confined to this explicitly isolated process.
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createParsedCache} from '../../../src/database/parsed-cache.js';
import {encodeStoredSnapshot,decodeStoredValue,isSerializedValue} from '../../../src/database/stored-value.js';
const root=process.argv[2],output=process.argv[3],raw={},rows=[];
const cache=createParsedCache();
async function measure(label){await new Promise(r=>setImmediate(r));global.gc();rows.push({label,...process.memoryUsage(),cache:cache.state()});await writeFile(output,JSON.stringify(rows,null,2));}
await measure('empty');
for(const file of ['database.json','smart-data.json','database-state.json','smart-state.json']){
 let parsed=JSON.parse(await readFile(path.join(root,file),'utf8'));
 if(parsed.format==='rss-keyed-overlay-v1'){
  const values={};for(const [key,name]of Object.entries(parsed.files)){
   if(path.basename(name)!==name)throw Error('Invalid snapshot part');
   try{values[key]=JSON.parse(await readFile(path.join(root,'database_state',file,name),'utf8')).value;}
   catch(e){if(e.code==='ENOENT')throw Error('Overlay changed during capture; retry read-only experiment');throw e;}
  }parsed=values;
 }else parsed=parsed.values||parsed;
 Object.assign(raw,encodeStoredSnapshot(parsed));parsed=null;await measure('stored:'+file);
}
await writeFile(output+'.sizes.json',JSON.stringify(Object.entries(raw).filter(([,v])=>isSerializedValue(v)).map(([key,value])=>({key,bytes:value.length})).sort((a,b)=>b.bytes-a.bytes),null,2));
for(let cycle=0;cycle<4;cycle++){
 for(const key of ['articles','smartRawArticles','smartClusters','topStoriesPublished','topStoriesState','cacheIdentityLedger','storyBriefings','smartTopPrefilterState','smartPersonalFilters']){
  const value=raw[key];if(!isSerializedValue(value))continue;
  let parsed=JSON.parse(decodeStoredValue(value));cache.set(key,value,parsed);parsed=null;
 }
 await measure('completed-parse-cycle:'+cycle);
}
cache.clear();await measure('cache-cleared');console.log(JSON.stringify(rows));
