import {encodeStoredSnapshot,decodeStoredValue,isSerializedValue} from '../../../src/database/stored-value.js';
// Read-only isolated approximation of the persistent and parsed owners.
import {readFile,writeFile} from 'node:fs/promises';
import {writeHeapSnapshot} from 'node:v8';
const root=process.argv[2]||'/home/ubuntu/my-rss-reader',output=process.argv[3]||'/tmp/rss-audit-followup-20261007/database-retention.json';
const owner={raw:{},parsed:{}};globalThis.auditDatabaseOwner=owner;const rows=[];
async function measure(label){await new Promise(r=>setImmediate(r));global.gc();const row={label,...process.memoryUsage()};rows.push(row);console.log(JSON.stringify(row));await writeFile(output,JSON.stringify(rows,null,2));}
await measure('empty');
for(const file of ['database.json','smart-data.json','database-state.json','smart-state.json']){let parsed;try{parsed=JSON.parse(await readFile(root+'/'+file,'utf8'));}catch(error){if(error.code==='ENOENT'&&file.includes('-state'))continue;throw error;}Object.assign(owner.raw,process.env.RSS_AUDIT_UTF8==='1'?encodeStoredSnapshot(parsed.values||parsed):(parsed.values||parsed));await measure('raw:'+file);}
const lengths=Object.entries(owner.raw).filter(([,v])=>isSerializedValue(v)).map(([key,value])=>({key,chars:value.length})).sort((a,b)=>b.chars-a.chars);await writeFile(output+'.sizes',JSON.stringify(lengths,null,2));
for(const key of ['articles','topStoriesPublished','smartClusters','topStoriesState','cacheIdentityLedger','storyBriefings','smartTopPrefilterState','smartEditorialAssessmentCache']){if(isSerializedValue(owner.raw[key])){owner.parsed[key]=JSON.parse(decodeStoredValue(owner.raw[key]));await measure('parsed:'+key);}}
if(process.env.RSS_AUDIT_HEAP_SNAPSHOT==='1')console.log(writeHeapSnapshot(output+'.heapsnapshot'));
