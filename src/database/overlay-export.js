import fs from 'node:fs/promises';
import path from 'node:path';
import {createKeyedOverlay} from './keyed-overlay.js';
import {writeJsonSnapshot} from './json-writer.js';

// Offline rollback conversion. Parts remain until the legacy file is durable.
export async function exportLegacyOverlay(filename) {
    let manifest;
    try { manifest=JSON.parse(await fs.readFile(filename,'utf8')); }
    catch(error) { if(error.code==='ENOENT')return false;throw error; }
    if(!manifest.format)return false;
    const allowedKeys=new Set(Object.keys(manifest.files||{}));
    if([...allowedKeys].some(key=>!/^\w+$/.test(key)))throw Error('Invalid overlay keys');
    const overlay=createKeyedOverlay({filename,allowedKeys});
    const legacy=await overlay.load(),temporary=filename+'.legacy-export';
    try {
        await writeJsonSnapshot(temporary,legacy);
        const handle=await fs.open(temporary,'r');try{await handle.sync();}finally{await handle.close();}
        await fs.rename(temporary,filename);
        const directory=await fs.open(path.dirname(filename),'r');try{await directory.sync();}finally{await directory.close();}
    }catch(error){await fs.unlink(temporary).catch(()=>{});throw error;}
    return true;
}
