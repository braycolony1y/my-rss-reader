// The existing database mutex, with bounded ownership diagnostics. No second
// scheduling policy: operations retain the same FIFO completion semantics.
export function createDatabaseTransactionQueue() {
    let tail = Promise.resolve(), sequence = 0, active = null, maxPending = 0, maxPendingBytes = 0, queuedBytes = 0;
    const waiting = new Map();
    const snapshot = () => ({pending:waiting.size,pendingBytes:queuedBytes,maxPending,maxPendingBytes,active:active ? {...active} : null});
    return {
        run(operation, {keys=[],bytes=0} = {}) {
            const id=++sequence,row={keys,bytes,queuedAt:Date.now()};waiting.set(id,row);queuedBytes+=bytes;
            maxPending=Math.max(maxPending,waiting.size);maxPendingBytes=Math.max(maxPendingBytes,queuedBytes);
            let release;const previous=tail;tail=new Promise(resolve=>{release=resolve;});
            return previous.then(()=>{waiting.delete(id);queuedBytes-=bytes;active={keys,bytes,waitMs:Date.now()-row.queuedAt,startedAt:Date.now()};return operation();})
                .finally(()=>{active=null;release();});
        },
        state:snapshot
    };
}
