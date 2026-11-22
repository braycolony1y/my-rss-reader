// Opt-in only: no production imports or background work until install() is called.
// Identifiers/text/URLs are fingerprinted locally; no article content is retained.
export function createEventRing({now=()=>performance.now(), capacity=1024, maxAge=60000}={}) {
    capacity=Math.max(1,Math.min(1024,Math.floor(capacity)||1024));
    const slots=new Array(capacity);let cursor=0,count=0,dropped=0;
    return {
        record(type,detail={}) {
            const row={at:now(),type,...detail};
            // Store bounded strings, never objects capable of retaining DOM/state.
            const text=JSON.stringify(row);
            if(text.length>768){dropped++;return;}
            slots[cursor]=text;cursor=(cursor+1)%capacity;count=Math.min(count+1,capacity);
        },
        export() {
            const cutoff=now()-Math.min(60000,maxAge),events=[];
            for(let i=0;i<count;i++){const row=JSON.parse(slots[(cursor-count+i+capacity)%capacity]);if(row.at>=cutoff)events.push(row);}
            return {events,dropped,capacity,maxAge:Math.min(60000,maxAge),maxStoredCharacters:capacity*768};
        },
        clear(){slots.fill(undefined);cursor=0;count=0;dropped=0;}
    };
}
function fingerprint(value) {
    const text=String(value??'');let hash=2166136261;
    for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),16777619);
    return (hash>>>0).toString(36);
}
export function installFlickerDiagnostics(win=window) {
    if(win.__readerFlicker)return win.__readerFlicker;
    const doc=win.document,ring=createEventRing({now:()=>win.performance.now()});
    const ids=new WeakMap(),known=new WeakMap(),cleanups=[];let sequence=0,stopped=false,lastState='';
    const id=value=>value&&typeof value==='object'?(ids.has(value)?ids.get(value):(ids.set(value,++sequence),sequence)):0;
    const app=()=>win.Alpine?.$data(doc.body);
    const context=()=>{const a=app();return {destination:fingerprint([a?.selectedFilterType,a?.selectedFilterValue,a?.smartTabMode].join('|')),generation:a?.articleRequestGeneration};};
    const record=(type,detail)=>ring.record(type,detail);
    const cardInfo=card=>{
        const a=win.Alpine?.$data(card)?.article,root=app(),img=card.querySelector('.thumbnail-img');
        return {node:id(card),article:fingerprint(a?.clusterId||a?.id||a?.guid||a?.originalLink||a?.link),feed:fingerprint(a?.feedUrl),
            row:fingerprint(root?.articleRowKey?.(a)),object:id(a),image:fingerprint(img?.getAttribute('src')),
            text:fingerprint(card.querySelector('h2')?.textContent),...context()};
    };
    const inspect=(card,reason)=>{
        if(!card)return;
        const next=cardInfo(card),previous=known.get(card);
        if(!previous||JSON.stringify(previous)!==JSON.stringify(next))record(reason,{...next,oldArticle:previous?.article,oldImage:previous?.image,reused:!!previous});
        known.set(card,next);
    };
    const cards=node=>node.nodeType===1?[...(node.matches('.article-card')?[node]:[]),...node.querySelectorAll('.article-card')]:[];
    doc.querySelectorAll('.article-card').forEach(card=>inspect(card,'initial-card'));
    const mutations=new win.MutationObserver(records=>{
        // A busy frame must not let the diagnostic monopolize the main thread.
        let visited=0;const changed=new Set();
        for(const r of records){
            if(++visited>200){record('mutation-overflow',{count:records.length});break;}
            if(r.type==='childList'){
                for(const node of r.removedNodes)for(const card of cards(node).slice(0,120))record(card.isConnected?'card-move':'card-remove',known.get(card)||{node:id(card)});
                for(const node of r.addedNodes)for(const card of cards(node).slice(0,120))inspect(card,'card-insert');
            }
            const element=r.target.nodeType===1?r.target:r.target.parentElement;
            const card=element?.closest('.article-card');if(card)changed.add(card);
            if(r.type==='attributes'&&element?.matches('.thumbnail-img'))record('image-attribute',{node:id(element),attribute:r.attributeName,value:fingerprint(element.getAttribute(r.attributeName)),...context()});
        }
        [...changed].slice(0,120).forEach(card=>inspect(card,'card-change'));
        record('mutation-batch',{count:records.length,cards:changed.size});
    });
    mutations.observe(doc.body,{subtree:true,childList:true,characterData:true,attributes:true,
        attributeFilter:['src','srcset','data-thumbnail-src','data-focus-state','data-image-layout']});
    cleanups.push(()=>mutations.disconnect());
    function listen(target,event,handler,capture=false){target.addEventListener(event,handler,capture);cleanups.push(()=>target.removeEventListener(event,handler,capture));}
    for(const event of ['load','error'])listen(doc,event,e=>{if(e.target.matches?.('.thumbnail-img')){record('image-'+event,{node:id(e.target),source:fingerprint(e.target.currentSrc||e.target.src),...context()});inspect(e.target.closest('.article-card'),'image-settled');}},true);
    listen(doc,'visibilitychange',()=>record('visibility',{hidden:doc.hidden,...context()}));
    for(const event of ['hashchange','pageshow','pagehide','resize'])listen(win,event,()=>record(event,context()));
    for(const type of ['longtask','layout-shift'])try{
        const observer=new win.PerformanceObserver(list=>{for(const e of list.getEntries().slice(0,50))record(type,{start:e.startTime,duration:e.duration,value:e.value,recentInput:e.hadRecentInput});});
        observer.observe({type,buffered:false});cleanups.push(()=>observer.disconnect());
    }catch{/* Engine does not expose this performance entry type. */}
    const originalFetch=win.fetch;
    const wrappedFetch=async function(input,options){
        const url=new URL(typeof input==='string'?input:input.url||String(input),win.location.href);
        const observed=url.origin===win.location.origin&&['/api/data','/api/article-content','/api/user-states'].includes(url.pathname);
        if(!observed)return originalFetch.call(this,input,options);
        const start=win.performance.now(),owner=context();record('request-start',{path:url.pathname,...owner});
        try{const response=await originalFetch.call(this,input,options);record('request-headers',{path:url.pathname,ms:win.performance.now()-start,status:response.status,obsolete:owner.generation!==context().generation,...owner});return response;}
        catch(error){record('request-failure',{path:url.pathname,aborted:error.name==='AbortError',...owner});throw error;}
    };
    win.fetch=wrappedFetch;cleanups.push(()=>{if(win.fetch===wrappedFetch)win.fetch=originalFetch;});
    const root=app();
    for(const name of ['setFilter','fetchData','applyBriefingUpdates','openArticleOverlay','closeArticleOverlay','syncUserStatesInBackground']) {
        if(typeof root?.[name]!=='function')continue;
        const original=root[name];
        const wrapped=function(...args){
            const owner=context(),start=win.performance.now();let expected=owner;record('method-start',{method:name,...owner});
            const finish=result=>{if(!stopped)record('method-complete',{method:name,ms:win.performance.now()-start,
                obsolete:expected.generation!==context().generation,failed:result?.failed===true,cancelled:result?.cancelled===true,...context()});};
            try{const result=original.apply(this,args);expected=context();if(result?.then)result.then(finish,()=>finish({failed:true}));else finish(result);return result;}
            catch(error){finish({failed:true});throw error;}
        };
        root[name]=wrapped;cleanups.push(()=>{if(root[name]===wrapped)root[name]=original;});
    }
    // Scalar/identity sampling only; never serialize feed/article payloads.
    let expected=win.performance.now()+250;
    const timer=win.setInterval(()=>{
        if(stopped)return;
        const now=win.performance.now();if(!doc.hidden&&now-expected>100)record('timer-delay',{ms:now-expected});expected=now+250;
        const a=app();if(!a)return;
        const state={...context(),array:id(a.articles),count:a.articles?.length,loading:a.isLoadingArticles,
            theme:a.theme,readCount:a.readStates?.size,overlay:a.articleOverlayOpen,article:fingerprint(a.overlayArticle?.link),token:fingerprint(a.smartViewToken)};
        const signature=JSON.stringify(state);if(signature!==lastState){record('state',state);lastState=signature;}
    },250);cleanups.push(()=>win.clearInterval(timer));
    const api={export:()=>ring.export(),mark:()=>record('user-mark',context()),clear:()=>ring.clear(),
        download(){const blob=new win.Blob([JSON.stringify(ring.export(),null,2)],{type:'application/json'}),url=win.URL.createObjectURL(blob),a=doc.createElement('a');a.href=url;a.download='reader-flicker.json';a.click();win.setTimeout(()=>win.URL.revokeObjectURL(url),1000);},
        stop(){stopped=true;cleanups.splice(0).forEach(fn=>fn());delete win.__readerFlicker;}};
    win.__readerFlicker=api;record('start',context());return api;
}
