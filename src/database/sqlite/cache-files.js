import fs from 'node:fs/promises';
import path from 'node:path';
import { hash } from './codec.js';
import { splitArchive, writeArchiveParts, hydrateArchive } from './archive-records.js';

export function cacheFilePath(root,filename){
    const relative=path.relative(root,path.resolve(filename)).split(path.sep).join('/');
    return /^article_cache\/(?:[^/.][^/]*\.json|threads\/[a-f0-9]{64}\.json|pdf\/[a-f0-9]{64}\/job\.json)$/.test(relative)?relative:null;
}
export function createCacheFiles(db){
    const get=db.prepare('SELECT * FROM cache_files WHERE path=? AND deleted=0');
    const priorDigest=db.prepare('SELECT digest,modified_at FROM cache_files WHERE path=? AND deleted=0');
    const put=db.prepare(`INSERT INTO cache_files(path,json,digest,bytes,modified_at,deleted,version,cached_at,url,source_deleted,deleted_detected_at) VALUES(?,?,?,?,?,0,?,?,?,?,?)
        ON CONFLICT(path) DO UPDATE SET json=excluded.json,digest=excluded.digest,bytes=excluded.bytes,modified_at=excluded.modified_at,deleted=0,
        version=excluded.version,cached_at=excluded.cached_at,url=excluded.url,source_deleted=excluded.source_deleted,deleted_detected_at=excluded.deleted_detected_at
        WHERE cache_files.digest<>excluded.digest OR cache_files.deleted<>0`);
    return {
        get:filename=>{const row=get.get(filename);if(!row)return null;
            if(filename.startsWith('article_cache/threads/')){let envelope;try{envelope=JSON.parse(row.json);}catch{return row;}
                row.json=JSON.stringify(hydrateArchive(db,filename,envelope));}
            return row;},
        info:filename=>db.prepare('SELECT path,deleted,bytes,modified_at FROM cache_files WHERE path=? AND deleted=0').get(filename)||null,
        list:prefix=>db.prepare('SELECT path,deleted,bytes,modified_at,version,cached_at,url,source_deleted,deleted_detected_at FROM cache_files WHERE substr(path,1,length(?))=? ORDER BY path').all(prefix,prefix),
        put(filename,json,modifiedAt=Date.now()){
            let parsed;try{parsed=JSON.parse(json);}catch{parsed=null;}
            const split=splitArchive(filename,parsed),canonical=split?JSON.stringify(parsed):json;
            const digest=hash(canonical),prior=priorDigest.get(filename);if(prior?.digest===digest)return digest;
            modifiedAt=Math.max(modifiedAt,(prior?.modified_at||0)+.001);
            const own=!db.isTransaction;if(own)db.exec('BEGIN IMMEDIATE');
            try{put.run(filename,split?JSON.stringify(split.envelope):json,digest,Buffer.byteLength(canonical),modifiedAt,
                Number.isFinite(parsed?.version)?parsed.version:null,Number.isFinite(parsed?.cachedAt)?parsed.cachedAt:null,
                parsed?.url||null,parsed?.result?.sourceDeleted?1:0,parsed?.result?.deletedDetectedAt||null);
                if(split)writeArchiveParts(db,filename,split.fields);
                if(own)db.exec('COMMIT');return digest;
            }catch(error){if(own&&db.isTransaction)db.exec('ROLLBACK');throw error;}
        },
        remove(filename){const own=!db.isTransaction;if(own)db.exec('BEGIN IMMEDIATE');try{
            db.prepare('DELETE FROM archive_entries WHERE path=?').run(filename);
            db.prepare("UPDATE cache_files SET json=NULL,digest='',bytes=0,deleted=1 WHERE path=?").run(filename);if(own)db.exec('COMMIT');
        }catch(error){if(own)db.exec('ROLLBACK');throw error;}},
    };
}
export async function importCacheFiles(root,db){
    const storage=createCacheFiles(db),files=[];
    const base=path.join(root,'article_cache');
    const visit=async directory=>{
        for(const entry of await fs.readdir(directory,{withFileTypes:true}).catch(error=>{if(error.code==='ENOENT')return [];throw error;})){
            const filename=path.join(directory,entry.name);
            if(entry.isDirectory()&&['threads','pdf'].includes(entry.name))await visit(filename);
            else if(entry.isDirectory()&&path.basename(directory)==='pdf'&&/^[a-f0-9]{64}$/.test(entry.name))await visit(filename);
            else if(entry.isFile()&&cacheFilePath(root,filename)){
                const before=await fs.stat(filename),text=await fs.readFile(filename,'utf8'),relative=cacheFilePath(root,filename);
                storage.put(relative,text,before.mtimeMs);
                const stored=storage.get(relative),after=await fs.stat(filename);
                let comparable=text;if(relative.startsWith('article_cache/threads/')){try{comparable=JSON.stringify(JSON.parse(text));}catch{}}
                if(stored.digest!==hash(comparable)||stored.digest!==hash(stored.json)||before.mtimeMs!==after.mtimeMs||before.size!==after.size)throw Error('Cache file changed during migration');
                files.push({path:relative,bytes:before.size,digest:stored.digest,originalDigest:hash(text)});
            }
        }
    };
    await visit(base);return files;
}
