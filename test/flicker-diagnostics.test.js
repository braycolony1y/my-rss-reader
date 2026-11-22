import test from 'node:test';
import assert from 'node:assert/strict';
import {createEventRing} from '../public/js/ui/flicker-diagnostics.js';
test('diagnostic ring bounds volume, expires history and rejects oversized payloads',()=>{
 let now=0;const ring=createEventRing({now:()=>now,capacity:3});
 for(let i=0;i<10;i++){now+=100;ring.record('event',{i});}
 assert.deepEqual(ring.export().events.map(e=>e.i),[7,8,9]);
 ring.record('large',{data:'x'.repeat(1000)});assert.equal(ring.export().dropped,1);
 now+=60001;assert.deepEqual(ring.export().events,[]);
 ring.clear();assert.equal(ring.export().dropped,0);
});

test('opt-in diagnostics restore methods, fetch and listeners on stop without retaining article text',async()=>{
 const {JSDOM}=await import('jsdom');const {installFlickerDiagnostics}=await import('../public/js/ui/flicker-diagnostics.js');
 const dom=new JSDOM('<body><div class="article-card"><h2>Private title</h2><img class="thumbnail-img"></div></body>',{url:'https://reader.test'});
 const win=dom.window,article={id:'secret-id',link:'https://private.test/article'};
 const fetch=async()=>({ok:true}),method=()=>42,app={articles:[article],article,articleRowKey:()=>article.id,setFilter:method};
 app.articleRequestGeneration=0;app.fetchData=function(){this.articleRequestGeneration++;return Promise.resolve({ok:true});};
 win.fetch=fetch;win.Alpine={$data:()=>app};
 try{const diagnostic=installFlickerDiagnostics(win);assert.notEqual(app.setFilter,method);assert.equal(app.setFilter(),42);
  await app.fetchData();
  assert.equal(diagnostic.export().events.find(e=>e.type==='method-complete'&&e.method==='fetchData').obsolete,false);
  const encoded=JSON.stringify(diagnostic.export());assert.ok(!encoded.includes('Private title'));assert.ok(!encoded.includes('secret-id'));assert.ok(!encoded.includes('private.test'));
  diagnostic.stop();assert.equal(app.setFilter,method);assert.equal(win.fetch,fetch);assert.equal(win.__readerFlicker,undefined);
 }finally{win.close();}
});
