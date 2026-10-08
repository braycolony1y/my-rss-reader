import fs from 'node:fs/promises';
import path from 'node:path';
import {createDatabasePersistence} from '../../../src/database/persistence.js';
import {createKeyedOverlay} from '../../../src/database/keyed-overlay.js';
import {writeJsonSnapshot} from '../../../src/database/json-writer.js';
import {encodeStoredSnapshot,encodeStoredValue,decodeStoredValue} from '../../../src/database/stored-value.js';
import {SMART_INCREMENTAL_KEYS} from '../../../src/database/state-policy.js';
const output=process.argv[2], source=process.argv[3];
const initial=encodeStoredSnapshot({...JSON.parse(await fs.readFile(path.join(source,'database.json'),'utf8')),...JSON.parse(await fs.readFile(path.join(source,'smart-data.json'),'utf8'))});
const smartKeys=new Set(Object.keys(JSON.parse(await fs.readFile(path.join(source,'smart-data.json'),'utf8'))));
const io=async()=>Object.fromEntries((await fs.readFile('/proc/self/io','utf8')).trim().split('\n').map(line=>line.split(/:\s*/)).map(([k,v])=>[k,Number(v)]));
const results=[];
for(const variant of ['before','after']) {
    const directory=await fs.mkdtemp('/tmp/rss-state-replay-'),writes=[];
    const atomic=async(file,value)=>{
        await writeJsonSnapshot(file+'.tmp',value);await fs.rename(file+'.tmp',file);
        writes.push({file:path.relative(directory,file),bytes:(await fs.stat(file)).size});
    };
    const SMART_STATE_KEYS=new Set(variant==='after'?SMART_INCREMENTAL_KEYS:[]);
    const STATE_KEYS=new Set(variant==='after'?['topStoriesState']:[]);
    let state={stateRevision:0,stateOverlay:{},smartStateRevision:0,smartStateOverlay:{}};
    const stateFiles=createKeyedOverlay({filename:path.join(directory,'state.json'),allowedKeys:STATE_KEYS,writeJson:atomic});
    const smartStateFiles=createKeyedOverlay({filename:path.join(directory,'smart-state.json'),allowedKeys:SMART_STATE_KEYS,writeJson:atomic});
    const persist=createDatabasePersistence({SMART_STATE_KEYS,STATE_KEYS,SMART_KEYS:smartKeys,NON_PERSISTED_DB_KEYS:new Set(),SMART_DB_FILE:path.join(directory,'smart.json'),DB_FILE:path.join(directory,'main.json'),stateFiles,smartStateFiles,
        getOverlayState:()=>state,commitOverlayState:update=>Object.assign(state,update),_writeJsonAtomic:atomic,_validateDatabaseSnapshot:()=>({ok:true}),_createRecoverySnapshot:async()=>{}});
    let data=initial;const start=performance.now(),before=await io();
    const samples=[];
    for(let cycle=0;cycle<3;cycle++)for(const key of ['smartCandidateSignature','smartClusterState','topStoriesState','topStoriesPublished']) {
        const original=decodeStoredValue(initial[key]);
        const value=key==='smartCandidateSignature'?`audit-${cycle}`:JSON.stringify({...JSON.parse(original||'{}'),auditRevision:cycle});
        const next={...data,[key]:encodeStoredValue(value)},at=performance.now();
        await persist(next,data,key);data=next;samples.push({cycle,key,ms:performance.now()-at});
    }
    const after=await io();
    if(variant==='after') {
        const recovered={...initial,...(await stateFiles.load()).values,...(await smartStateFiles.load()).values};
        for(const key of Object.keys(data))if(decodeStoredValue(recovered[key])!==decodeStoredValue(data[key]))throw Error(`Recovery mismatch: ${key}`);
    }
    results.push({variant,ms:performance.now()-start,physicalWriteBytes:after.write_bytes-before.write_bytes,syscallWriteBytes:after.wchar-before.wchar,writes,samples});
    await fs.writeFile(output,JSON.stringify(results,null,2));console.log(JSON.stringify({...results.at(-1),writes:writes.length}));
    await fs.rm(directory,{recursive:true,force:true});
}
