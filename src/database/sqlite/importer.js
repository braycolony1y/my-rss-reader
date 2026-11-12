import { createHash } from 'node:crypto';
import { readFile, mkdtemp, rm, readdir, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { legacyFields, fieldEntries, fieldShape, scalarField } from './legacy-stream.js';
import { rowIdentity, CHILD_FIELDS, CRITICAL_ARRAYS } from './codec.js';

export async function importLegacy(root, db, repository) {
    await mkdir(path.join(root,'database_state'),{recursive:true,mode:0o700});
    const directory=await mkdtemp(path.join(root,'database_state','sqlite-import-'));
    const imported = [];
    async function importFieldValue(field, overrideKey) {
        const key=overrideKey ?? field.key;
        // Embeddings already have their independent incremental file cache.
        if(key==='smartEmbeddings')return;
        const shape=await fieldShape(field);
        if(shape==='scalar') { repository.write(key,await scalarField(field),{allowLargeReduction:true});return; }
        const encoding=field.string?'json':'native';
        const previous=repository.beginCollection(key,encoding,shape), seen=new Map(), digest=createHash('sha256');
        // A newer overlay replaces the complete key, including removals.
        const {tableFor}=await import('./codec.js');
        db.prepare(`DELETE FROM ${tableFor(key)} WHERE collection=?`).run(key);
        let count=0;digest.update('[');
        for await(const entry of fieldEntries(field,shape)) {
            const id=shape==='array'?rowIdentity(entry.value,entry.key,seen):entry.key;
            const rowDigest=repository.record(key,id,count,entry.value);
            const effective=CHILD_FIELDS[key]?.has(id)&&entry.value&&typeof entry.value==='object'?repository.info(`$${key}.${id}`).digest:rowDigest;
            digest.update((count?',':'')+JSON.stringify([id,effective]));count++;
        }
        digest.update(']');
        repository.finishCollection(key,previous,encoding,shape,digest.digest('hex'),count);
        imported.push({key,shape,count});
        console.info('[SQLITE MIGRATION]',key,count,'records');
    }
    async function importField(field,overrideKey){
        db.exec('SAVEPOINT legacy_field');
        try{await importFieldValue(field,overrideKey);db.exec('RELEASE legacy_field');}
        catch(error){
            db.exec('ROLLBACK TO legacy_field; RELEASE legacy_field');
            if(!field.string||CRITICAL_ARRAYS.has(overrideKey??field.key))throw error;
            // Some legacy identifiers are arbitrary text beginning with '{'.
            // Preserve them exactly rather than treating them as damaged JSON.
            repository.write(overrideKey??field.key,await scalarField(field));
        }
    }
    async function snapshot(filename) { for await(const field of legacyFields(filename,directory)) await importField(field); }
    async function existing(filename) { try{await stat(filename);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;} }
    try {
        let candidates=[path.join(root,'database.json'),path.join(root,'database.json.backup')];
        const rotations=await readdir(path.join(root,'db_backups')).catch(()=>[]);
        candidates.push(...rotations.filter(name=>/^database-.*\.json$/.test(name)).sort().reverse().map(name=>path.join(root,'db_backups',name)));
        let found=false, attempted=false, lastError;
        for(const file of candidates) {
            if(!await existing(file))continue;
            attempted=true;db.exec('SAVEPOINT legacy_main');
            try {
                await snapshot(file);
                if(repository.info('articles')?.shape!=='array'||repository.info('feeds')?.shape!=='array')throw Error('Legacy snapshot lacks valid articles/feeds');
                db.exec('RELEASE legacy_main');found=true;break;
            }catch(error){db.exec('ROLLBACK TO legacy_main; RELEASE legacy_main');
                if(!/Parser|valid articles\/feeds|not a valid array|Incomplete legacy JSON/.test(error.message)&&!(error instanceof SyntaxError))throw error;
                lastError=error;}
        }
        if(!found){if(attempted)throw new Error('No valid legacy database; refusing empty migration',{cause:lastError});repository.write('articles','[]');repository.write('feeds','[]');}
        const smartFiles=['smart-data.json','smart-data.json.backup'];let smartFound=false,smartAttempted=false;
        for(const name of smartFiles){const file=path.join(root,name);if(!await existing(file))continue;smartAttempted=true;db.exec('SAVEPOINT legacy_smart');
            try{await snapshot(file);db.exec('RELEASE legacy_smart');smartFound=true;break;}
            catch(error){db.exec('ROLLBACK TO legacy_smart; RELEASE legacy_smart');
                if(!/Parser|not a valid array|Incomplete legacy JSON/.test(error.message)&&!(error instanceof SyntaxError))throw error;
                lastError=error;}}
        if(smartAttempted&&!smartFound)throw new Error('No valid Smart snapshot; refusing data loss',{cause:lastError});
        for(const [name,revisionKey] of [['smart-state.json','__smartStateRevision'],['database-state.json','__stateRevision']]) {
            const file=path.join(root,name);if(!await existing(file))continue;
            const manifest=JSON.parse(await readFile(file,'utf8'));
            if(!Number.isSafeInteger(manifest.revision)||manifest.revision<0)throw Error('Invalid legacy overlay revision');
            if(manifest.revision<=Number(repository.read(revisionKey)||0))continue;
            if(manifest.format){
                if(manifest.format!=='rss-keyed-overlay-v1'||!manifest.files)throw Error('Invalid legacy overlay format');
                for(const [key,part]of Object.entries(manifest.files)){
                    if(path.basename(part)!==part||!new RegExp(`^\\d+\\.${key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\.json$`).test(part))throw Error('Unsafe legacy overlay path');
                    let loaded=false;
                    for await(const field of legacyFields(path.join(root,'database_state',name,part),directory))if(field.key==='value'){await importField(field,key);loaded=true;}
                    if(!loaded)throw Error('Invalid legacy overlay part');
                }
            }else if(manifest.values&&typeof manifest.values==='object'){
                for(const [key,value]of Object.entries(manifest.values))repository.write(key,value,{allowLargeReduction:true});
            }else throw Error('Invalid legacy overlay');
            repository.write(revisionKey,manifest.revision);
        }
        return imported;
    } finally {await rm(directory,{recursive:true,force:true});}
}
