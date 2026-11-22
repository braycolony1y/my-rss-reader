import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { writeJsonSnapshot } from '../json-writer.js';

export async function syncDirectory(directory) {
    const handle=await fs.open(directory,'r');try{await handle.sync();}finally{await handle.close();}
}
export async function atomicJson(filename,value) {
    await fs.mkdir(path.dirname(filename),{recursive:true,mode:0o700});
    const temporary=filename+'.tmp-'+randomUUID();
    try {
        await writeJsonSnapshot(temporary,value);
        await fs.chmod(temporary,0o600);
        const handle=await fs.open(temporary,'r');try{await handle.sync();}finally{await handle.close();}
        await fs.rename(temporary,filename);await syncDirectory(path.dirname(filename));
    } finally {await fs.rm(temporary,{force:true});}
}
export async function fileHash(filename) {
    const digest=createHash('sha256');for await(const chunk of createReadStream(filename))digest.update(chunk);return digest.digest('hex');
}
export async function exists(filename) {try{await fs.stat(filename);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
