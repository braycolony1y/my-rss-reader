// Standalone collector, suitable for a transient systemd unit. Each sample is
// appended immediately so a disconnect cannot discard the completed interval.
import {readFile,appendFile} from 'node:fs/promises';
const [root,output,hours='6']=process.argv.slice(2);
if(!root||!output)throw Error('Usage: soak.mjs ROOT OUTPUT.jsonl [hours]');
const end=Date.now()+Number(hours)*3600000;
let previous=null;
do {
    const row={at:Date.now()};
    try {
        row.pid=JSON.parse(await readFile(root+'/database.writer.lock','utf8')).pid;
        const io=await readFile(`/proc/${row.pid}/io`,'utf8');
        row.io=Object.fromEntries(io.trim().split('\n').map(line=>line.split(/:\s*/)).map(([key,value])=>[key,Number(value)]));
        row.resources=await(await fetch('http://127.0.0.1:3000/api/resources',{headers:{Cookie:'auth=true'},signal:AbortSignal.timeout(10000)})).json();
        const status=await(await fetch('http://127.0.0.1:3000/api/smart-status',{headers:{Cookie:'auth=true'},signal:AbortSignal.timeout(10000)})).json();
        row.smart={state:status.state,running:status.running,startedAt:status.startedAt,completedAt:status.completedAt,
            stage:status.progress?.stage,current:status.progress?.current,total:status.progress?.total};
        const r=row.resources;
        // RSS active state is not exposed by this endpoint. This is only an
        // idle candidate, never proof that every job has finished.
        row.observedIdleCandidate=!r.smartRunning&&!r.jobs?.length&&!r.activeArticleRequests&&!r.ai?.active?.total&&!r.ai?.pending&&!r.localCompute?.active&&!r.localCompute?.pending?.length&&!r.parsedCache?.transactions?.active&&!r.parsedCache?.transactions?.pending&&!r.articleQueues?.foreground?.active&&!r.articleQueues?.foreground?.pending&&!r.articleQueues?.other?.active&&!r.articleQueues?.other?.pending&&!r.browserBudget?.active&&!r.browserBudget?.pending;
        const sameProcess=previous?.pid===row.pid;
        row.boundary={pidChanged:Boolean(previous&&previous.pid!==row.pid),
            rssCompleted:Boolean(sameProcess&&previous.resources?.at&&r.lastSyncCompletedAt&&r.lastSyncCompletedAt!==previous.resources.lastSyncCompletedAt),
            smartCompletionChanged:Boolean(sameProcess&&previous.smart&&row.smart.completedAt&&row.smart.completedAt!==previous.smart.completedAt),
            smartBecameIdle:sameProcess&&previous?.resources?.smartRunning===true&&r.smartRunning===false};
    }catch(error){row.error=error.message;}
    await appendFile(output,JSON.stringify(row)+'\n');previous=row;
    if(Date.now()<end)await new Promise(resolve=>setTimeout(resolve,30000));
}while(Date.now()<end);
