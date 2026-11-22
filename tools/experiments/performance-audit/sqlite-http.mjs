import fs from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';

const [backend,root,output]=process.argv.slice(2);
if(!['legacy','sqlite'].includes(backend)||!root?.startsWith('/tmp/')||!output)throw Error('Requires backend, isolated /tmp root and output');
process.chdir(root);
process.env.ANTIGRAVITY_ENABLED='false';process.env.GEMINI_WEB_ENABLED='false';process.env.SMART_LOCAL_AI_ENABLED='false';delete process.env.GEMINI_API_KEY;
const {createApplication}=await import('../../../src/app.js');
const {createLegacyDatabaseStore}=await import('../../../src/database/store.js');
const {createSqliteDatabaseStore}=await import('../../../src/database/sqlite/store.js');
const io=async()=>Object.fromEntries((await fs.readFile('/proc/self/io','utf8')).trim().split('\n').map(line=>{const [k,v]=line.split(':');return[k,Number(v)];}));
const startedAt=performance.now();
const databaseStore=backend==='legacy'?createLegacyDatabaseStore():createSqliteDatabaseStore({root});
const application=await createApplication({databaseStore});
const coldMs=performance.now()-startedAt;
if(process.env.RSS_SQLITE_AUDIT_CLOCK){const now=Number(process.env.RSS_SQLITE_AUDIT_CLOCK);if(!Number.isFinite(now))throw Error('Invalid audit clock');Date.now=()=>now;}
const server=application.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
const before={memory:process.memoryUsage(),io:await io()},rows=[];
const routes=[['today','/api/data?filterType=today&limit=30&hideRead=false'],
    ['saved','/api/data?filterType=saved&limit=30'],['recent','/api/data?filterType=recent&limit=30'],
    ['board','/api/data?filterType=board&limit=30'],
    ['smart-classic','/api/data?filterType=smart&filterValue=tech_vietnam&smartMode=classic&limit=30'],
    ['smart-top','/api/data?filterType=smart&filterValue=tech_vietnam&smartMode=top&limit=30']];
for(let pass=0;pass<Number(process.env.RSS_SQLITE_AUDIT_PASSES||4);pass++)for(const [label,route]of routes){
    const start=performance.now();const response=await fetch('http://127.0.0.1:'+server.address().port+route,{headers:{Cookie:'auth=true'},signal:AbortSignal.timeout(90000)});
    const text=await response.text(),data=JSON.parse(text);
    rows.push({pass,label,status:response.status,ms:performance.now()-start,bytes:Buffer.byteLength(text),
        articleCount:data.articles?.length,links:data.articles?.map(row=>row.link),
        articleHash:createHash('sha256').update(JSON.stringify(data.articles)).digest('hex'),memory:process.memoryUsage()});
}
const after={memory:process.memoryUsage(),io:await io()};
await fs.writeFile(output,JSON.stringify({backend,root,coldMs,before,after,rows,storage:databaseStore.getResourceState()},null,2));
console.log(JSON.stringify({backend,coldMs,rssMB:Math.round(after.memory.rss/1024/1024),rows:rows.length}));
server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await databaseStore.close?.();
// Parser workers and fixture-independent schedulers are process-owned.
process.exit(0);
