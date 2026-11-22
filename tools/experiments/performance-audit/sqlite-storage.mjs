import fs from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

const [backend,root,output]=process.argv.slice(2);
if(!['legacy','sqlite'].includes(backend)||!root?.startsWith('/tmp/')||!output)throw Error('Usage: sqlite-storage.mjs legacy|sqlite /tmp/ISOLATED_ROOT OUTPUT');
process.chdir(root);
process.env.ANTIGRAVITY_ENABLED='false';process.env.GEMINI_WEB_ENABLED='false';process.env.SMART_LOCAL_AI_ENABLED='false';delete process.env.GEMINI_API_KEY;
const {createLegacyDatabaseStore}=await import('../../../src/database/store.js');
const {createSqliteDatabaseStore}=await import('../../../src/database/sqlite/store.js');
const rows=[];
const io=async()=>Object.fromEntries((await fs.readFile('/proc/self/io','utf8')).trim().split('\n').map(row=>{const [key,value]=row.split(':');return [key,Number(value.trim())];}));
async function measure(label,operation){
    const before=await io(),memoryBefore=process.memoryUsage(),start=performance.now();
    const result=await operation();
    const elapsedMs=performance.now()-start,after=await io();
    rows.push({label,elapsedMs,memoryBefore,memoryAfter:process.memoryUsage(),io:Object.fromEntries(Object.keys(after).map(key=>[key,after[key]-before[key]]))});
    return result;
}
const store=backend==='legacy'?createLegacyDatabaseStore():createSqliteDatabaseStore({root});
const db=store.env.RSS_DATA;
try{
    await measure('cold-open',()=>store.initializeWriterLock(false));
    const articles=await measure('read-articles',()=>db.get('articles',{type:'json',shared:true}));
    const selected=articles.slice(0,20).map(article=>article.link);
    await measure('smart-lookup-20',async()=>db.findArticles?db.findArticles('smartClusters',{links:selected}):(await db.get('smartClusters',{type:'json'})).filter(article=>selected.includes(article.link)));
    const preferences=await db.get('userPreferences',{type:'json'});
    await measure('ten-preference-updates',async()=>{for(let i=0;i<10;i++){
        if(db.patchEntries)await db.patchEntries('userPreferences',{sqliteBenchmark:i});
        else await db.put('userPreferences',JSON.stringify({...preferences,sqliteBenchmark:i}));
    }});
    const changed=articles.map((article,index)=>index?article:{...article,sqliteBenchmark:'one-record-change'});
    await measure('one-article-update',()=>db.put('articles',JSON.stringify(changed)));
    const fingerprint=await measure('ranking-fingerprint',()=>db.get('smartClusters',{fingerprint:true}));
    if(!fingerprint?.digest)throw Error('Missing fingerprint');
    await fs.writeFile(output,JSON.stringify({backend,root,at:Date.now(),rows,resources:store.getResourceState(),finalMemory:process.memoryUsage()},null,2));
    console.log(JSON.stringify({backend,rows:rows.map(row=>({label:row.label,ms:Math.round(row.elapsedMs),rssMB:Math.round(row.memoryAfter.rss/1024/1024),writeBytes:row.io.write_bytes,wchar:row.io.wchar}))},null,2));
}finally{await store.close?.();}
