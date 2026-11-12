const KEY='smartEventVerificationCache';
export async function loadVerificationEntry(db,key){
    if(db.getEntries)return (await db.getEntries(KEY,[key]))[key]||null;
    const cache=await db.get(KEY,{type:'json'})||{};return cache[key]||null;
}
export async function saveVerificationEntry(db,key,value){
    if(db.patchEntries)return db.patchEntries(KEY,{[key]:value});
    const cache=await db.get(KEY,{type:'json'})||{};cache[key]=value;return db.put(KEY,JSON.stringify(cache));
}
