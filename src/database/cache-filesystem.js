import nativeFs from 'node:fs/promises';
import path from 'node:path';
import { cacheFilePath } from './sqlite/cache-files.js';

// Keep existing archive retention/rendering while JSON records move to SQLite.
// Binary media and PDFs continue using ordinary file I/O.
export function createCacheFilesystem(db,{root=process.cwd()}={}){
    if(!db?.cacheGet)return nativeFs;
    const missing=filename=>Object.assign(Error(`No cached record: ${filename}`),{code:'ENOENT'});
    return {...nativeFs,
        async readFile(filename,options){
            const relative=cacheFilePath(root,filename);if(!relative)return nativeFs.readFile(filename,options);
            const row=await db.cacheGet(relative);if(!row)throw missing(filename);
            const encoding=typeof options==='string'?options:options?.encoding;
            return encoding==='utf8'||encoding==='utf-8'?row.json:encoding?Buffer.from(row.json).toString(encoding):Buffer.from(row.json);
        },
        async stat(filename,options){const relative=cacheFilePath(root,filename);if(!relative)return nativeFs.stat(filename,options);
            const row=await db.cacheInfo(relative);if(!row)throw missing(filename);
            return {size:row.bytes,mtimeMs:row.modified_at,ctimeMs:row.modified_at,mtime:new Date(row.modified_at),isFile:()=>true,isDirectory:()=>false};},
        async unlink(filename){const relative=cacheFilePath(root,filename);if(!relative)return nativeFs.unlink(filename);await db.cacheRemove(relative);},
        async rm(filename,options){
            const relative=cacheFilePath(root,filename);if(relative)return db.cacheRemove(relative);
            const prefix=path.relative(root,path.resolve(filename)).split(path.sep).join('/')+'/';
            if(options?.recursive&&prefix.startsWith('article_cache/'))
                for(const row of await db.cacheList(prefix))if(!row.deleted)await db.cacheRemove(row.path);
            return nativeFs.rm(filename,options);
        },
        async readdir(directory,options){
            const prefix=path.relative(root,path.resolve(directory)).split(path.sep).join('/')+'/';
            if(!prefix.startsWith('article_cache/'))return nativeFs.readdir(directory,options);
            const original=await nativeFs.readdir(directory,options).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
            const rows=(await db.cacheList(prefix)).filter(row=>!row.path.slice(prefix.length).includes('/'));
            const managed=new Map(rows.map(row=>[path.basename(row.path),row]));
            const names=new Map(original.filter(entry=>!managed.has(typeof entry==='string'?entry:entry.name)||!managed.get(typeof entry==='string'?entry:entry.name).deleted)
                .map(entry=>[typeof entry==='string'?entry:entry.name,entry]));
            for(const row of rows)if(!row.deleted&&!names.has(path.basename(row.path))){const name=path.basename(row.path);names.set(name,options?.withFileTypes?{name,isFile:()=>true,isDirectory:()=>false}:name);}
            return [...names.values()];
        },
    };
}

export async function writeCacheJson(db,filename,value,fallback,{root=process.cwd()}={}){
    const relative=cacheFilePath(root,filename);
    if(!relative||!db?.cachePut)return fallback(filename,value);
    const json=typeof value==='string'?value:JSON.stringify(value);JSON.parse(json);
    return db.cachePut(relative,json);
}
