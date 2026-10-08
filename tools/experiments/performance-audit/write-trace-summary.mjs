import {readFile,writeFile} from 'node:fs/promises';
const rows=new Map(),pending=new Map();
for(const line of (await readFile(process.argv[2],'utf8')).split('\n')) {
    let match=/^(\d+) .*?(?:write|pwrite64|writev)\(\d+<(\/[^>]+)>/.exec(line),file;
    if(match) {
        file=match[2].replace(/\.tmp[-.].*/,'');
        if(line.includes('<unfinished')){pending.set(match[1],file);continue;}
    } else if(line.includes('resumed>')) {
        const pid=line.split(/\s+/)[0];file=pending.get(pid);pending.delete(pid);
    }
    const ret=/= (\d+)\s*$/.exec(line);
    if(!file||!ret)continue;
    const bytes=Number(ret[1]),row=rows.get(file)||{file,count:0,bytes:0,maxBytes:0};
    row.count++;row.bytes+=bytes;row.maxBytes=Math.max(row.maxBytes,bytes);rows.set(file,row);
}
const sorted=[...rows.values()].sort((a,b)=>b.bytes-a.bytes).map(row=>({...row,averageBytes:row.bytes/row.count}));
if(process.argv[3])await writeFile(process.argv[3],JSON.stringify(sorted,null,2));
console.log(JSON.stringify(sorted.slice(0,15),null,2));
