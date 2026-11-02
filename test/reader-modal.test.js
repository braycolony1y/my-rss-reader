import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';import {JSDOM} from 'jsdom';
const script=name=>readFileSync(new URL('../public/js/'+name,import.meta.url),'utf8');
function fixture(html=''){
 const dom=new JSDOM(`<div id="overlay-scroll-container"><div class="article-rendered-content">${html}</div></div>`,{url:"https://reader.test"}),ctx=vm.createContext({window:dom.window,document:dom.window.document,console,setTimeout,clearTimeout,performance,localStorage:dom.window.localStorage});
 return {dom,ctx,root:dom.window.document.querySelector('.article-rendered-content')};
}
const post=(id,text=id)=>`<div class="voz-post" data-post-index="${id}" data-absolute-post-id="${id}"><p>${text}</p><img src="photo-${id}.jpg"><iframe src="about:blank"></iframe></div>`;
function renderFixture(html){const f=fixture();vm.runInContext(script('sources/voz-post-reconcile.js')+'\n'+script('article/content-renderer.js'),f.ctx);f.ctx.root=f.root;f.ctx.html=html;vm.runInContext('ReaderArticleContent.render(root,html)',f.ctx);return f;}
function reconcile(f,html,history=false){f.ctx.fresh=new f.dom.window.DOMParser().parseFromString(html,'text/html').querySelectorAll('.voz-post');f.ctx.history=history;return vm.runInContext('ReaderVozPostReconcile.reconcile(root,Array.from(fresh),history)',f.ctx);}
test('unchanged refresh retains post, decoded-image and iframe nodes with zero child mutations',async()=>{const f=renderFixture(post(1)+post(2));const nodes=[...f.root.querySelectorAll('*')];let mutations=0;const o=new f.dom.window.MutationObserver(r=>mutations+=r.length);o.observe(f.root,{subtree:true,childList:true});assert.equal(reconcile(f,post(1)+post(2)).changed,false);await Promise.resolve();assert.equal(mutations,0);assert.ok(nodes.every(n=>n.isConnected));o.disconnect();f.dom.window.close()});
test('publisher edit replaces only its own post; appending keeps other media and adoption avoids second render',()=>{const f=renderFixture(post(1)+post(2));const first=f.root.firstElementChild;const update=reconcile(f,post(1)+post(2,'edited')+post(3));assert.equal(update.changed,true);assert.equal(f.root.firstElementChild,first);assert.equal(f.root.children[1].textContent,'edited');f.ctx.html=update.html;vm.runInContext('ReaderArticleContent.adopt(root,html); ReaderArticleContent.render(root,html)',f.ctx);assert.equal(f.root.firstElementChild,first);f.dom.window.close()});
test('widget hydration and open spoilers survive unchanged source refresh',()=>{const f=renderFixture(post(1));const media=f.root.querySelector('iframe');media.setAttribute('data-hydrated','true');f.root.querySelector('p').classList.add('expanded');assert.equal(reconcile(f,post(1)).changed,false);assert.equal(f.root.querySelector('iframe'),media);f.dom.window.close()});
test('Cache-board preserves missing historical posts and cached bodies in order',()=>{const f=renderFixture(post(1)+post(2)+post(3));const old=[...f.root.children];reconcile(f,post(1,'live edit')+post(3)+post(4),true);assert.deepEqual([...f.root.children].map(n=>n.dataset.absolutePostId),['1','2','3','4']);assert.equal(f.root.firstElementChild,old[0]);assert.equal(f.root.children[1],old[1]);f.dom.window.close()});
test('ordinary live pages follow deletion and reordering without cloning retained nodes',()=>{const f=renderFixture(post(1)+post(2)+post(3));const third=f.root.children[2];reconcile(f,post(3)+post(1));assert.equal(f.root.children.length,2);assert.equal(f.root.firstElementChild,third);f.dom.window.close()});
test('ambiguous post identities refuse a destructive refresh',()=>{const f=renderFixture(post(1)+post(2));const node=f.root.firstElementChild;assert.equal(reconcile(f,post(1)+post(1)).invalid,true);assert.equal(f.root.firstElementChild,node);f.dom.window.close()});
test('article replacement and clearing release old DOM; same content render is a no-op',()=>{const f=renderFixture(post(1));const node=f.root.firstElementChild;vm.runInContext('ReaderArticleContent.render(root,html)',f.ctx);assert.equal(f.root.firstElementChild,node);f.ctx.html='<p>Next article</p>';vm.runInContext('ReaderArticleContent.render(root,html)',f.ctx);assert.equal(node.isConnected,false);vm.runInContext('ReaderArticleContent.render(root,null)',f.ctx);assert.equal(f.root.children.length,0);f.dom.window.close()});
test('final VOZ checkpoint is sampled before a pending scroll callback and stale timers cannot write',()=>{const f=fixture(post(1)+post(2)+post(3));const timers=new Map();let id=0;f.ctx.setTimeout=fn=>{timers.set(++id,fn);return id};f.ctx.clearTimeout=k=>timers.delete(k);vm.runInContext(script('sources/voz-scroll-position.js'),f.ctx);const sc=f.dom.window.document.getElementById('overlay-scroll-container');sc.getBoundingClientRect=()=>({top:0});[...f.root.children].forEach((n,i)=>n.getBoundingClientRect=()=>({top:(i-1)*300,bottom:i*300}));const writes=[];f.ctx.app={articleOverlayOpen:true,overlayRequestId:'A',overlayArticle:{link:'https://voz.vn/t/example.123456'},overlayPagination:{currentPage:2},syncUserPreferenceDebounced:(...v)=>writes.push(v)};f.ctx.event={currentTarget:sc};vm.runInContext('ReaderVozScrollPosition.track(app,event)',f.ctx);assert.equal(writes.length,0);vm.runInContext('ReaderVozScrollPosition.flush(app)',f.ctx);assert.equal(JSON.parse(writes[0][1]).absId,'2');assert.equal(JSON.parse(writes[0][1]).page,2);assert.equal(timers.size,0);vm.runInContext('ReaderVozScrollPosition.track(app,event)',f.ctx);f.ctx.app.overlayRequestId='B';for(const fn of timers.values())fn();assert.equal(writes.length,1);f.dom.window.close()});
test('overlapping progress flushes serialize requests and retain newer pending position',async()=>{const calls=[],resolvers=[];const ctx=vm.createContext({console,clearTimeout,localStorage:{setItem(){}},fetch:async(u,o)=>{calls.push(JSON.parse(o.body));return new Promise(r=>resolvers.push(r))}});vm.runInContext(script('app/preference-writes.js'),ctx);const shared={preferenceWriteOwner:Object.freeze({}),pendingPreferences:{voz_last_read_post_1:'old'},userPreferences:{},syncPrefsTimer:{}};ctx.app=new Proxy(shared,{});const first=vm.runInContext('ReaderPreferenceWrites.flush(app)',ctx);ctx.app=new Proxy(shared,{});ctx.app.pendingPreferences.voz_last_read_post_1='new';const second=vm.runInContext('ReaderPreferenceWrites.flush(app)',ctx);assert.equal(calls.length,1);resolvers[0]({ok:true,json:async()=>({value:'old'})});await new Promise(r=>setImmediate(r));assert.equal(calls.length,2);assert.equal(calls[1].value,'new');assert.equal(ctx.app.pendingPreferences.voz_last_read_post_1,'new');resolvers[1]({ok:true,json:async()=>({value:'new'})});await Promise.all([first,second]);assert.equal(ctx.app.userPreferences.voz_last_read_post_1,'new');assert.deepEqual(Object.keys(ctx.app.pendingPreferences),[])});
test('failed position request remains pending and can be retried',async()=>{let ok=false;const ctx=vm.createContext({clearTimeout,localStorage:{setItem(){}},fetch:async()=>({ok,json:async()=>({})})});vm.runInContext(script('app/preference-writes.js'),ctx);ctx.app={pendingPreferences:{position:'value'},userPreferences:{}};await vm.runInContext('ReaderPreferenceWrites.flush(app)',ctx);assert.equal(ctx.app.pendingPreferences.position,'value');ok=true;await vm.runInContext('ReaderPreferenceWrites.flush(app)',ctx);assert.equal(ctx.app.pendingPreferences.position,undefined)});
test('explicit back-navigation restore suppresses double anchoring through the rendering boundary and rejects stale restores',()=>{
 const f=renderFixture(post(1)),scroll=f.root.parentElement,frames=new Map();let id=0;
 f.ctx.scroll=scroll;f.ctx.requestAnimationFrame=fn=>{frames.set(++id,fn);return id};f.ctx.cancelAnimationFrame=k=>frames.delete(k);
 vm.runInContext('globalThis.token=ReaderArticleContent.beginRestore(scroll); ReaderArticleContent.restorePosition(scroll,token,1200)',f.ctx);
 assert.equal(scroll.style.overflowAnchor,'none');
 const runFrame=()=>{const current=[...frames.values()];frames.clear();current.forEach(fn=>fn())};
 runFrame();assert.equal(scroll.scrollTop,1200);assert.equal(scroll.style.overflowAnchor,'none');runFrame();assert.equal(scroll.style.overflowAnchor,'none');runFrame();assert.equal(scroll.style.overflowAnchor,'');
 vm.runInContext('globalThis.oldToken=ReaderArticleContent.beginRestore(scroll); ReaderArticleContent.cancelRestore(scroll); ReaderArticleContent.restorePosition(scroll,oldToken,10)',f.ctx);
 assert.equal(scroll.scrollTop,1200);assert.equal(frames.size,0);f.dom.window.close();
});

test('Alpine evaluator proxies share one checkpoint owner across repeated scroll and close expressions',()=>{
 const f=fixture(post(1));const timers=new Map();let id=0;
 f.ctx.setTimeout=fn=>{timers.set(++id,fn);return id};f.ctx.clearTimeout=k=>timers.delete(k);
 vm.runInContext(script('sources/voz-scroll-position.js'),f.ctx);
 const sc=f.root.parentElement;sc.getBoundingClientRect=()=>({top:0});f.root.firstElementChild.getBoundingClientRect=()=>({top:0});
 const writes=[];const base={vozScrollOwner:Object.freeze({}),articleOverlayOpen:true,overlayRequestId:'A',overlayArticle:{link:'https://voz.vn/t/example.123456'},syncUserPreferenceDebounced:(...args)=>writes.push(args)};
 f.ctx.event={currentTarget:sc};
 for(let i=0;i<20;i++){f.ctx.app=new Proxy(base,{});vm.runInContext('ReaderVozScrollPosition.track(app,event)',f.ctx)}
 assert.equal(timers.size,1);f.ctx.app=new Proxy(base,{});vm.runInContext('ReaderVozScrollPosition.flush(app)',f.ctx);assert.equal(timers.size,0);assert.equal(writes.length,1);f.dom.window.close();
});

test('delayed insert effects cannot reset a closed, replaced or restored reader',()=>{
 const ctx=vm.createContext({document:{getElementById(){assert.fail('stale render touched the DOM')}},window:{}});
 vm.runInContext(script('article/render-effects.js'),ctx);
 for(const state of [{articleOverlayOpen:false,overlayRequestId:'old'},{articleOverlayOpen:true,overlayRequestId:'new'},{articleOverlayOpen:true,overlayRequestId:''}]){
  ctx.app=state;vm.runInContext("ReaderArticleRenderEffects.afterInsert(app,'old',false)",ctx);
 }
});
test('current insert effects initialize widgets and the native scroll owner normally',()=>{
 const f=fixture('<p>Current article</p>'),scroll=f.root.parentElement;scroll.scrollTop=100;
 let hydrated=0,resumed=0;f.ctx.app={articleOverlayOpen:true,overlayRequestId:'current',hydrateTwitterEmbeds(root){assert.equal(root,scroll);hydrated++},checkVozThreadPosition(){resumed++}};
 vm.runInContext(script('article/render-effects.js'),f.ctx);vm.runInContext("ReaderArticleRenderEffects.afterInsert(app,'current',false)",f.ctx);
 assert.equal(scroll.scrollTop,0);assert.equal(hydrated,1);assert.equal(resumed,1);f.dom.window.close();
});
test('user input cancels the pending restore and lifecycle saving retains the last checkpoint until visibility is ready',()=>{
 const f=renderFixture(post(1)),scroll=f.root.parentElement,frames=new Map();let id=0,writes=0;
 f.ctx.scroll=scroll;f.ctx.requestAnimationFrame=fn=>{frames.set(++id,fn);return id};f.ctx.cancelAnimationFrame=k=>frames.delete(k);
 vm.runInContext(script('sources/voz-scroll-position.js'),f.ctx);f.ctx.app={articleOverlayOpen:true,overlayRequestId:'restored',overlayArticle:{link:'https://voz.vn/t/example.123456'},syncUserPreferenceDebounced(){writes++}};
 vm.runInContext('globalThis.token=ReaderArticleContent.beginRestore(scroll); ReaderArticleContent.restorePosition(scroll,token,1200); ReaderVozScrollPosition.flush(app)',f.ctx);assert.equal(writes,0);assert.equal(frames.size,1);
 scroll.dispatchEvent(new f.dom.window.Event('wheel'));assert.equal(frames.size,0);assert.equal(scroll.scrollTop,0);assert.equal(scroll.style.overflowAnchor,'');f.dom.window.close();
});
