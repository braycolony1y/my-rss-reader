import { Worker } from 'node:worker_threads';

const running = new Map();
export function runStorageMaintenance(options,action,settings={},signal){
    if(signal?.aborted)return Promise.reject(signal.reason);
    const key=JSON.stringify([options.filename,action,settings]);
    if(running.has(key))return running.get(key);
    const environment={...process.env};delete environment.NODE_TEST_CONTEXT;
    const operation=new Promise((resolve,reject)=>{
        const worker=new Worker(new URL('./maintenance-worker.js',import.meta.url),{workerData:{...options,action,options:settings},env:environment,execArgv:[],resourceLimits:{maxOldGenerationSizeMb:384}});
        let message,failure;
        const abort=()=>{failure=signal.reason;void worker.terminate();};
        signal?.addEventListener('abort',abort,{once:true});
        worker.once('message',value=>{message=value;});
        worker.once('error',error=>{failure=error;});
        // Resolve only after DB close and worker exit. This is also the shutdown
        // barrier: releasing the writer lock cannot leave a mutation worker alive.
        worker.once('exit',code=>{
            signal?.removeEventListener('abort',abort);
            if(failure)return reject(failure);
            if(!message)return reject(Error(`Maintenance worker exited (${code}) without a result`));
            if(message.error)reject(Object.assign(Error(message.error.message),message.error));else resolve(message.result);
        });
    }).finally(()=>running.delete(key));
    running.set(key,operation);return operation;
}
