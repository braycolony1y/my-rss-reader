import { hash } from './codec.js';

export function splitArchive(filename,parsed){
    if(!filename.startsWith('article_cache/threads/')||!parsed||typeof parsed!=='object')return null;
    const envelope={...parsed},fields=[];
    for(const field of ['posts','legacy_snapshots']){
        const value=parsed[field];if(!value||typeof value!=='object')continue;
        const shape=Array.isArray(value)?'array':'object';
        fields.push({field,shape,value});envelope[field]={$sqliteArchiveField:field,shape};
    }
    return {envelope,fields};
}
export function writeArchiveParts(db,filename,fields){
    const select=db.prepare('SELECT entry_key,digest,position FROM archive_entries WHERE path=? AND field=?');
    const put=db.prepare(`INSERT INTO archive_entries VALUES(?,?,?,?,?,?) ON CONFLICT(path,field,entry_key) DO UPDATE SET
        position=excluded.position,payload=excluded.payload,digest=excluded.digest WHERE digest<>excluded.digest OR position<>excluded.position`);
    const remove=db.prepare('DELETE FROM archive_entries WHERE path=? AND field=? AND entry_key=?');
    const wantedFields=new Set(fields.map(row=>row.field));
    for(const row of db.prepare('SELECT DISTINCT field FROM archive_entries WHERE path=?').all(filename))
        if(!wantedFields.has(row.field))db.prepare('DELETE FROM archive_entries WHERE path=? AND field=?').run(filename,row.field);
    for(const {field,shape,value}of fields){
        const previous=new Map(select.all(filename,field).map(row=>[row.entry_key,row]));
        const entries=shape==='array'?value.entries():Object.entries(value);let position=0;
        for(const [key,entry]of entries){const id=String(key),payload=JSON.stringify(entry),digest=hash(payload),old=previous.get(id);
            if(old?.digest!==digest||old.position!==position)put.run(filename,field,id,position,payload,digest);
            previous.delete(id);position++;}
        for(const key of previous.keys())remove.run(filename,field,key);
    }
}
export function hydrateArchive(db,filename,envelope){
    for(const field of ['posts','legacy_snapshots']){
        const marker=envelope?.[field];if(marker?.$sqliteArchiveField!==field)continue;
        const rows=db.prepare('SELECT entry_key,payload FROM archive_entries WHERE path=? AND field=? ORDER BY position').all(filename,field);
        envelope[field]=marker.shape==='array'?rows.map(row=>JSON.parse(row.payload)):Object.fromEntries(rows.map(row=>[row.entry_key,JSON.parse(row.payload)]));
    }
    return envelope;
}
