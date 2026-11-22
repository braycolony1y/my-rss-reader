import {PerformanceObserver} from 'node:perf_hooks';
import {getHeapSpaceStatistics} from 'node:v8';

// Observe natural collection only. Sampling never requests GC or clears caches.
export function observeCollections() {
    let count=0, durationMs=0, maxMs=0, kinds={};
    const observer=new PerformanceObserver(list=>{
        for(const entry of list.getEntries()) {
            count++;durationMs+=entry.duration;maxMs=Math.max(maxMs,entry.duration);
            const kind=entry.detail?.kind ?? 'unknown';kinds[kind]=(kinds[kind]||0)+1;
        }
    });
    observer.observe({entryTypes:['gc']});
    return {
        sample() {
            const result={gc:{count,durationMs,maxMs,kinds},heapSpaces:getHeapSpaceStatistics().map(space=>({name:space.space_name,size:space.space_size,used:space.space_used_size,physical:space.physical_space_size}))};
            count=0;durationMs=0;maxMs=0;kinds={};return result;
        },
        stop(){observer.disconnect();}
    };
}
