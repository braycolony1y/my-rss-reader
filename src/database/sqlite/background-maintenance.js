import { Worker } from 'node:worker_threads';

export function runStorageMaintenance(options,action,settings={}){
    const environment={...process.env};delete environment.NODE_TEST_CONTEXT;
    return new Promise((resolve,reject)=>{
        const worker=new Worker(new URL('./maintenance-worker.js',import.meta.url),{workerData:{...options,action,options:settings},env:environment,execArgv:[],resourceLimits:{maxOldGenerationSizeMb:128}});
        let received=false;
        worker.once('message',message=>{received=true;if(message.error)reject(Object.assign(Error(message.error.message),message.error));else resolve(message.result);});
        worker.once('error',reject);worker.once('exit',code=>{if(!received)reject(Error(`Maintenance worker exited (${code}) without a result`));});
    });
}
