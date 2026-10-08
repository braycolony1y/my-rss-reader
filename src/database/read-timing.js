import {AsyncLocalStorage} from 'node:async_hooks';
const reads=new AsyncLocalStorage();
export function traceDatabaseReads(callback) { return reads.run(new Map(),callback); }
export function measureDatabaseRead(key,phase,operation) {
    const totals=reads.getStore();
    if(!totals)return operation();
    const start=performance.now();
    try{return operation();}finally{
        const name=`db-${String(key).replace(/[^\w-]/g,'')}-${phase}`;
        totals.set(name,(totals.get(name)||0)+performance.now()-start);
    }
}
export function databaseReadTimings() {
    return [...(reads.getStore()||[])].map(([name,ms])=>`${name};dur=${ms.toFixed(3)}`).join(', ');
}
