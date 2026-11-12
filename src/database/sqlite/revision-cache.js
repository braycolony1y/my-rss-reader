// Cache decoded graphs only, never a second retained copy of the serialized
// corpus. Weak entries preserve shared identity while a caller owns that graph.
export function createRevisionCache({maxBytes=48*1024*1024,maxEntries=64}={}) {
    const strong=new Map(),weak=new Map();let bytes=0,hits=0,misses=0;
    const remove=key=>{const row=strong.get(key);if(row){bytes-=row.bytes;strong.delete(key);}};
    return {
        get(key,revision){
            const row=strong.get(key),entry=row||weak.get(key);
            const value=entry?.revision===revision?(row?.value||entry.ref?.deref()):undefined;
            if(value===undefined){remove(key);weak.delete(key);misses++;return;}
            hits++;if(row){strong.delete(key);strong.set(key,row);}return value;
        },
        set(key,revision,value,size){
            remove(key);if(!value||typeof value!=='object')return;
            weak.delete(key);weak.set(key,{revision,ref:new WeakRef(value)});
            while(weak.size>maxEntries)weak.delete(weak.keys().next().value);
            if(size>maxBytes)return;
            strong.set(key,{revision,value,bytes:size});bytes+=size;
            while(bytes>maxBytes||strong.size>maxEntries)remove(strong.keys().next().value);
        },
        invalidate(key){remove(key);weak.delete(key);},
        clear(){strong.clear();weak.clear();bytes=0;},
        state(){return {entries:strong.size,estimatedSourceBytes:bytes,maxBytes,hits,misses};}
    };
}
