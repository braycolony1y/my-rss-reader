import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {readMemoryBudget, hasWorkerHeadroom, boundedWorkerOptions} from '../src/observability/memory-budget.js';
const MB=1024*1024;
test('worker budget counts swapped working memory but excludes reclaimable file cache',()=>{
 const values={'/proc/self/cgroup':'0::/system.slice/rss-reader.service\n','memory.high':String(5120*MB),'memory.max':String(6144*MB),'memory.stat':`anon ${3000*MB}\nkernel ${100*MB}\nfile ${800*MB}\n`,'memory.swap.current':String(800*MB)};
 const budget=readMemoryBudget({read:file=>values[file]??values[file.split('/').at(-1)],memory:()=>({rss:3050*MB})});
 assert.equal(budget.used,3900*MB);assert.equal(budget.limit,5120*MB);
 assert.equal(hasWorkerHeadroom(1280,budget),false);assert.equal(hasWorkerHeadroom(512,budget),true);
});
test('unavailable cgroup data does not permanently block ranking',()=>{
 const budget=readMemoryBudget({read:()=>{throw Error('unsupported')},memory:()=>({rss:1024})});
 assert.equal(hasWorkerHeadroom(1280,budget),true);
});
test('worker heap bound takes effect even when the parent command line raises its own limit',async()=>{
 const options=boundedWorkerOptions(128,['--max-old-space-size=4096','--expose-gc','--max_old_space_size','4096']);
 assert.deepEqual(options.execArgv,[]);
 // --expose-gc cannot be supplied explicitly to Workers on all Node versions.
 const worker=new Worker('const {parentPort,resourceLimits}=require("node:worker_threads");parentPort.postMessage(resourceLimits.maxOldGenerationSizeMb)',{eval:true,...boundedWorkerOptions(128,['--max-old-space-size=4096'])});
 assert.equal(await new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject)}),128);
 await worker.terminate();
});
