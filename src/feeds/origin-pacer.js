// Preserve the existing 500 ms publisher courtesy interval without sleeping
// between unrelated publishers. The owner is one bounded feed-sync cycle.
export function createOriginPacer({intervalMs=500,now=Date.now,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
    const starts=new Map();
    return async url=>{
        const origin=new URL(url).origin,time=now(),start=Math.max(time,starts.get(origin)||0);
        starts.set(origin,start+intervalMs);
        if(start>time)await wait(start-time);
    };
}
