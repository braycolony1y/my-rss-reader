import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export async function assertOffline(root) {
    // The host unit check prevents a namespaced PID check mistaking the real
    // application's PID for a stale lock. Unknown service state fails closed.
    if(path.resolve(root)==='/home/ubuntu/my-rss-reader'){
        const status=spawnSync('systemctl',['show','rss-reader','-p','ActiveState','--value'],{encoding:'utf8'});
        if(status.status!==0)throw Error('Cannot verify host service state; run this operation on the service host');
        if(!['inactive','failed'].includes(status.stdout.trim()))throw Error('Stop rss-reader before this operation');
    }
    try{
        const owner=JSON.parse(await fs.readFile(path.join(root,'database.writer.lock'),'utf8'));
        if(Number(owner.pid)>0){try{process.kill(owner.pid,0);}catch(error){if(error.code==='ESRCH')return;throw error;}throw Error('Database writer is still running');}
    }catch(error){if(error.code!=='ENOENT')throw error;}
}
