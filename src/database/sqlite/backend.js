import fs from 'node:fs';
import path from 'node:path';
export function selectedBackend(root=process.cwd()){
    if(process.env.RSS_STORAGE_BACKEND){
        if(!['sqlite','json'].includes(process.env.RSS_STORAGE_BACKEND))throw Error('Invalid RSS_STORAGE_BACKEND');
        return process.env.RSS_STORAGE_BACKEND;
    }
    try{const choice=JSON.parse(fs.readFileSync(path.join(root,'database_state','backend.json'),'utf8'));
        if(!['sqlite','json'].includes(choice.backend))throw Error('Invalid storage backend marker');return choice.backend;
    }catch(error){if(error.code==='ENOENT')return 'sqlite';throw error;}
}
