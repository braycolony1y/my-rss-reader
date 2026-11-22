export function createPreferenceUpdater({db,locked,get,put,identity,isCache}){
    return (key,value)=>locked(async()=>{
        const prefs=await get('userPreferences',{});
        if(key==='boardFolderMappings'){
            if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Folder mappings must be an object');
            const mappings={...(prefs.boardFolderMappings||{})},known=new Set(Object.keys(mappings).map(identity));
            for(const [url,folder]of Object.entries(value)){
                const id=identity(url);
                if(id&&!known.has(id)&&typeof folder==='string'&&folder.trim()){
                    mappings[url]=isCache(folder)?'cache':folder;known.add(id);
                }
            }
            prefs[key]=mappings;
        }else prefs[key]=value;
        if(db.patchEntries)await db.patchEntries('userPreferences',{[key]:prefs[key]});
        else await put('userPreferences',prefs);
        return prefs;
    });
}
