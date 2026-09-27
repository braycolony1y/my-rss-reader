// Read-only production-corpus check. No database writes or provider requests.
import fs from 'node:fs/promises';
import {Worker} from 'node:worker_threads';
import {boundedWorkerOptions} from '../../src/observability/memory-budget.js';
const main=JSON.parse(await fs.readFile('database.json','utf8'));
const smart=JSON.parse(await fs.readFile('smart-data.json','utf8'));
const started=Date.now();
const worker=new Worker(new URL('../../src/articles/top-stories-worker.js',import.meta.url),{
 ...boundedWorkerOptions(1024),
 workerData:{publicationJson:smart.smartClusters,rawJson:smart.smartRawArticles,statesJson:main.topStoriesState||'{}',sources:JSON.parse(main.smartSources||'[]'),now:Date.now()}
});
const timer=setTimeout(()=>{void worker.terminate();},180000);
try {
 const result=await new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);worker.once('exit',code=>reject(Error(`Worker exited ${code} without a result`)));});
 if(result.error||result.skipped)throw Error(result.error||'Ranking skipped');
 console.log(JSON.stringify({articles:result.articles.length,uniqueIds:new Set(result.articles.map(a=>a.clusterId)).size,heapLimitMB:worker.resourceLimits.maxOldGenerationSizeMb,elapsedMs:Date.now()-started}));
} finally {clearTimeout(timer);await worker.terminate();}
