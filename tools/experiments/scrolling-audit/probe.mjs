// Opt-in diagnostic instrumentation. Never loaded by the production page.
export function installScrollProbe({ observers = false } = {}) {
    const probe = window.__scrollProbe = { callbacks: {}, mutations: [], events: [], longTasks: [], shifts: [] };
    if (observers) for (const name of ['MutationObserver', 'ResizeObserver', 'IntersectionObserver']) {
        const Original = window[name];
        if (!Original) continue;
        window[name] = class extends Original {
            constructor(callback, options) {
                const origin = new Error().stack;
                super((entries, owner) => {
                    const start = performance.now();
                    try { callback(entries, owner); }
                    finally {
                        const key = origin.split('\n').slice(2, 5).join('\n');
                        const row = probe.callbacks[key] ||= { name, count: 0, entries: 0, ms: 0, max: 0 };
                        const elapsed = performance.now() - start;
                        row.count++; row.entries += entries.length; row.ms += elapsed; row.max = Math.max(row.max, elapsed);
                    }
                }, options);
            }
        };
    }
    for (const [type, key] of [['longtask', 'longTasks'], ['layout-shift', 'shifts']]) {
        try { new PerformanceObserver(list => { for (const e of list.getEntries()) if (probe[key].length < 1000) probe[key].push({ at:e.startTime, duration:e.duration, value:e.value, input:e.hadRecentInput }); }).observe({ type, buffered:true }); } catch {}
    }
    document.addEventListener('DOMContentLoaded', () => {
        if (!observers) return;
        const root = document.getElementById('scroll-container');
        new MutationObserver(records => {
            for (const r of records) {
                const card = r.target.closest?.('.article-card');
                if (!card || probe.mutations.length >= 15000) continue;
                if (r.type === 'attributes') {
                    const value = r.target.getAttribute(r.attributeName);
                    probe.mutations.push({at:performance.now(), id:card.dataset.smartClusterId, node:r.target.tagName+'.'+String(r.target.className).slice(0,80), name:r.attributeName, same:value===r.oldValue, old:r.attributeName==='src'?r.oldValue?.slice(0,160):undefined, value:r.attributeName==='src'?value?.slice(0,160):undefined});
                } else probe.mutations.push({at:performance.now(), id:card.dataset.smartClusterId, child:true, removed:r.removedNodes.length, added:r.addedNodes.length});
            }
        }).observe(root,{subtree:true,childList:true,attributes:true,attributeOldValue:true,attributeFilter:['src','class','style','data-focus-state','data-story-blend','data-story-image-missing']});
        for (const type of ['load','error']) document.addEventListener(type,e=>{
            if(e.target.matches?.('.thumbnail-img,.thumbnail-soft')&&probe.events.length<4000)probe.events.push({at:performance.now(),type,id:e.target.closest('.article-card')?.dataset.smartClusterId,kind:e.target.className,src:e.target.getAttribute('src')?.slice(0,160)});
        },true);
    });
}

export async function sampleScroll({ duration = 8000, distance = 7000, diagnostic = false, warm = false } = {}) {
    const sc = document.getElementById('scroll-container'), cards = [...sc.querySelectorAll('.article-card')];
    const original = new Set(cards), frames = [], firstVisible = {}, firstImage = {}, disappeared = [], heights = new Map(), replaced = new Set();
    const quantile = (values, fraction) => values.slice().sort((a,b)=>a-b)[Math.max(0,Math.ceil(values.length*fraction)-1)] || 0;
    let start, last, maxJump = 0, previousScroll = 0, previousCommand = 0;
    sc.scrollTop = 0;
    await new Promise(resolve => requestAnimationFrame(function tick(at) {
        start ??= at; const elapsed = at-start;
        if(last)frames.push(at-last); last=at;
        const fraction=Math.min(1,elapsed/duration), path=fraction<.65?fraction/.65:(1-fraction)/.35;
        const command = Math.round(Math.min(distance,sc.scrollHeight-sc.clientHeight)*path);
        const scrollBefore=sc.scrollTop;
        maxJump=Math.max(maxJump,Math.abs((scrollBefore-previousScroll)-(previousCommand-previousScroll)));
        sc.scrollTop=command; previousScroll=scrollBefore;previousCommand=sc.scrollTop;
        if (diagnostic) {
            const rr=sc.getBoundingClientRect();
            for(const card of cards) {
                if(!card.isConnected){replaced.add(card.dataset.smartClusterId);continue;}
                const rect=card.getBoundingClientRect(), id=card.dataset.smartClusterId||cards.indexOf(card);
                if(rect.bottom<=rr.top||rect.top>=rr.bottom)continue;
                firstVisible[id]??=at;
                const image=card.querySelector('.thumbnail-img'), style=image&&getComputedStyle(image);
                const shown=image?.complete&&image.naturalWidth>0&&Number(style.opacity)>0&&style.visibility!=='hidden'&&style.display!=='none';
                if(shown)firstImage[id]??=at;
                else if(firstImage[id]&&disappeared.length<1000)disappeared.push({at,id,src:image?.getAttribute('src'),state:image?.dataset.focusState});
                if(!heights.has(id))heights.set(id,rect.height);
            }
        }
        if(elapsed<duration)requestAnimationFrame(tick);else resolve();
    }));
    const delay=Object.entries(firstVisible).map(([id,at])=>({id,delay:(firstImage[id]??last)-at,shown:!!firstImage[id]}));
    return { duration:last-start,frames:frames.length,avg:frames.reduce((a,b)=>a+b,0)/frames.length,p95:quantile(frames,.95),p99:quantile(frames,.99),max:Math.max(...frames),over16_7:frames.filter(x=>x>16.7).length,overBudget:frames.filter(x=>x>17.2).length,over33:frames.filter(x=>x>33.3).length,over50:frames.filter(x=>x>50).length,frameTimes:frames,delay,disappeared,replaced:[...replaced],maxJump,cardCount:cards.length,geometry:cards.slice(0,8).map(c=>{const r=c.getBoundingClientRect();return [r.width,r.height];}),...window.__scrollProbe};
}
