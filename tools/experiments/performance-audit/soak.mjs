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
        const r=row.resources;
        row.quiescent=!r.smartRunning&&!r.jobs?.length&&!r.activeArticleRequests&&!r.ai?.active?.total&&!r.localCompute?.active&&!r.parsedCache?.transactions?.active&&!r.parsedCache?.transactions?.pending&&!r.articleQueues?.foreground?.active&&!r.articleQueues?.other?.active;
        row.boundary={pidChanged:previous&&previous.pid!==row.pid,rssCompleted:r.lastSyncCompletedAt!==previous?.resources?.lastSyncCompletedAt,smartCompleted:previous?.resources?.smartRunning===true&&r.smartRunning===false};
    }catch(error){row.error=error.message;}
    await appendFile(output,JSON.stringify(row)+'\n');previous=row;
    if(Date.now()<end)await new Promise(resolve=>setTimeout(resolve,30000));
}while(Date.now()<end);
