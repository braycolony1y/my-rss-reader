import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { createTaskWorker } from '../src/runtime/task-worker.js';
import { createOriginPacer } from '../src/feeds/origin-pacer.js';

test('pooled CPU tasks keep response ownership, reuse workers, and reject an uncertain exit without replay',async t=>{
    let starts=0;
    const source=`import {parentPort} from 'node:worker_threads';let calls=0;parentPort.on('message',({id,input})=>{if(input==='exit')process.exit(0);parentPort.postMessage({id,result:{input,calls:++calls}});});`;
    const pool=createTaskWorker({createWorker(){starts++;return new Worker(new URL('data:text/javascript,'+encodeURIComponent(source)));}});t.after(()=>pool.close());
    const results=await Promise.all([pool.run('a'),pool.run('b')]);assert.deepEqual(results,[{input:'a',calls:1},{input:'b',calls:2}]);assert.equal(starts,1);
    await assert.rejects(pool.run('exit'),/before returning a result/);assert.equal(starts,1);
    assert.deepEqual(await pool.run('c'),{input:'c',calls:1});assert.equal(starts,2);
});

test('queued CPU tasks recycle the worker before changing its heap configuration',async t=>{
    const starts=[];
    const source=`import {parentPort} from 'node:worker_threads';let calls=0;parentPort.on('message',({id,input})=>parentPort.postMessage({id,result:{budget:input.budget,calls:++calls}}));`;
    const pool=createTaskWorker({workerKey:input=>input.budget,createWorker(input){starts.push(input.budget);return new Worker(new URL('data:text/javascript,'+encodeURIComponent(source)));}});
    t.after(()=>pool.close());
    assert.deepEqual(await Promise.all([pool.run({budget:1024}),pool.run({budget:512}),pool.run({budget:512})]),[{budget:1024,calls:1},{budget:512,calls:1},{budget:512,calls:2}]);
    assert.deepEqual(starts,[1024,512]);
    let restarts=0;
    const finite=createTaskWorker({maxJobs:1,createWorker(){restarts++;return new Worker(new URL('data:text/javascript,'+encodeURIComponent(source)));}});
    t.after(()=>finite.close());
    const repeated=await Promise.all([finite.run({budget:512}),finite.run({budget:512})]);
    assert.deepEqual(repeated,[{budget:512,calls:1},{budget:512,calls:1}]);assert.equal(restarts,2);
});

test('feed pacing reserves publisher slots without delaying unrelated sources',async()=>{
    const waits=[];const pace=createOriginPacer({now:()=>1000,wait:async ms=>waits.push(ms)});
    await Promise.all([pace('https://a.example/rss'),pace('https://b.example/rss'),pace('https://a.example/other'),pace('https://a.example/third')]);
    assert.deepEqual(waits,[500,1000]);
});

test('a disabled AI provider does not spawn a startup quota subprocess',async()=>{
    const {createAntigravityProvider}=await import('../src/ai/antigravity.js');let calls=0;
    const runtime={retryAt:0,checkPromise:null,lastCheckAt:0,stateLoaded:false,startupCheckStarted:false};
    const generate=createAntigravityProvider({available:()=>false,quotaRuntime:runtime,run(){calls++;}});
    await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,0);assert.equal(runtime.startupCheckStarted,false);
    await assert.rejects(generate('hello'),/not available/);
});
