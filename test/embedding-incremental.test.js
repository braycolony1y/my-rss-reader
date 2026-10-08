import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {mergeIncrementalEmbeddingCache as merge,loadIncrementalEmbeddingSubset as load} from '../src/smart/embeddings/incremental-cache.js';
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'rss-vectors-incremental-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return path.join(root,'vectors.json');}
async function read(file,keys){const data={};const stats=await load(file,new Set(keys),values=>Object.assign(data,values));return {data,...stats};}
test('incremental vectors preserve legacy data, changed vectors, restarts and streaming compaction',async t=>{
    const file=await fixture(t);await fs.writeFile(file,JSON.stringify({old:'AA==',needed:'AQ=='}));const original=await fs.readFile(file,'utf8');
    assert.deepEqual(await read(file,['needed']),{data:{needed:'AQ=='},entries:2,matched:1});
    assert.equal(await merge(file,{needed:'Ag==',added:'Aw=='}),3);
    for(let i=0;i<8;i++)await merge(file,{['key'+i]:'BA==',needed:String(i)},{maxParts:2});
    const result=await read(file,['old','needed','added',...Array.from({length:8},(_,i)=>'key'+i)]);
    assert.equal(result.entries,11);assert.equal(result.matched,11);assert.equal(result.data.needed,'7');assert.equal(result.data.old,'AA==');assert.equal(result.data.added,'Aw==');
    assert.equal(await fs.readFile(file,'utf8'),original,'legacy base is never rewritten');
    const manifest=JSON.parse(await fs.readFile(path.join(path.dirname(file),'database_state/embeddings/vectors.json/manifest.json'),'utf8'));
    assert.ok(Object.keys(manifest.parts).length<=2);
});
test('interruption before manifest publication keeps all previous vectors, and post-commit failure remains recoverable',async t=>{
    const file=await fixture(t);await fs.writeFile(file,'{"old":"AA=="}');await merge(file,{saved:'AQ=='});
    for(const stage of ['part-durable','manifest-ready']){
        await assert.rejects(merge(file,{saved:'BAD',new:'BAD'},{checkpoint:async phase=>{if(phase===stage)throw Error('interrupted');}}),/interrupted/);
        assert.deepEqual(await read(file,['old','saved','new']),{data:{old:'AA==',saved:'AQ=='},entries:2,matched:2});
    }
    await assert.rejects(merge(file,{saved:'Ag=='},{checkpoint:async phase=>{if(phase==='manifest-durable')throw Error('after commit');}}),/after commit/);
    assert.equal((await read(file,['saved'])).data.saved,'Ag==');
});
test('invalid legacy input and altered legacy bases fail closed; missing initial cache is supported',async t=>{
    const file=await fixture(t);await fs.writeFile(file,'{"broken":');await assert.rejects(merge(file,{new:'AA=='}));assert.equal(await fs.readFile(file,'utf8'),'{"broken":');
    await fs.unlink(file);assert.equal(await merge(file,{new:'AA=='}),1);assert.equal((await read(file,['new'])).data.new,'AA==');
    await fs.writeFile(file,'{}');await assert.rejects(read(file,['new']),/base changed/);
});

test('SIGKILL during part write, before manifest rename and after durable commit recovers exactly', {timeout:20000},async t=>{
    const file=await fixture(t);await fs.writeFile(file,'{"old":"AA=="}');
    for(const stage of ['part-writing','part-durable','manifest-ready','manifest-durable']){
        await merge(file,{saved:'previous'});
        const env={...process.env};delete env.NODE_TEST_CONTEXT;
        const child=fork(new URL('./helpers/embedding-crash-worker.js',import.meta.url),[file,stage],{env,execArgv:[],stdio:['ignore','ignore','pipe','ipc']});
        const exit=once(child,'exit');
        try{await Promise.race([once(child,'message'),exit.then(()=>{throw Error('Child exited before fault boundary');})]);child.kill('SIGKILL');await exit;}
        finally{child.kill('SIGKILL');}
        const recovered=await read(file,['old','saved','new-99']);
        assert.equal(recovered.data.old,'AA==');
        assert.equal(recovered.data.saved,stage==='manifest-durable'?'new':'previous');
        if(stage!=='manifest-durable')assert.equal(recovered.data['new-99'],undefined);
    }
    await merge(file,{saved:'healthy'});
    const directory=path.join(path.dirname(file),'database_state/embeddings/vectors.json');
    const manifest=JSON.parse(await fs.readFile(path.join(directory,'manifest.json'),'utf8'));
    assert.deepEqual((await fs.readdir(directory)).sort(),['manifest.json',...Object.values(manifest.parts).map(part=>part.file)].sort());
});
