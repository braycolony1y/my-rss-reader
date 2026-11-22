import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { writeCacheJson } from '../database/cache-filesystem.js';

export function createPdfJobPersistence(db,directory){
    return async job=>{
        const folder=path.join(directory,job.id);await fs.mkdir(folder,{recursive:true});
        return writeCacheJson(db,path.join(folder,'job.json'),job,async(filename,value)=>{
            const temporary=filename+'.'+randomUUID()+'.tmp';await fs.writeFile(temporary,JSON.stringify(value));await fs.rename(temporary,filename);
        });
    };
}
