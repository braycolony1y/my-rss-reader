import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {installThumbnailLoading} from '../public/thumbnail-loading.js';
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
test('thumbnail admission reserves connections and releases stale navigation',{timeout:3000},async()=>{
 const dom=new JSDOM('<body>'+Array.from({length:5},(_,i)=>`<img data-thumbnail-src="/api/og-image?i=${i}">`).join('')+'</body>',{url:'http://reader.test'});
 const win=dom.window,images=[...win.document.images],stop=installThumbnailLoading(win);
 try{
  assert.equal(images.filter(i=>i.hasAttribute('src')).length,2);
  images[0].dispatchEvent(new win.Event('load'));await tick();assert.ok(images[2].src);
  images[1].remove();await tick();assert.ok(images[3].src);assert.equal(images[1].hasAttribute('src'),false);
  images[2].dispatchEvent(new win.Event('load'));await tick();assert.ok(images[4].src);
 }finally{stop();win.close();}
});
test('existing source fallback keeps the same admission slot until it loads',{timeout:3000},async()=>{
 const dom=new JSDOM('<body><img data-thumbnail-src="/api/og-image?a"><img data-thumbnail-src="/api/og-image?b"><img data-thumbnail-src="/api/og-image?c"></body>',{url:'http://reader.test'});
 const win=dom.window,[a,b,c]=win.document.images,stop=installThumbnailLoading(win);
 try{
  a.addEventListener('error',()=>a.src='/api/og-image?fallback',{once:true});
  a.dispatchEvent(new win.Event('error'));await tick();assert.equal(c.hasAttribute('src'),false);
  a.dispatchEvent(new win.Event('load'));await tick();assert.ok(c.src);
 }finally{stop();win.close();}
});
test('direct image URLs retain native loading and offscreen expensive images wait',{timeout:3000},async()=>{
 const dom=new JSDOM('<body><img data-thumbnail-src="https://publisher.test/photo.jpg"><img data-thumbnail-src="/api/og-image?a"></body>',{url:'http://reader.test'});
 const win=dom.window;let enter;
 win.IntersectionObserver=class{constructor(fn,options){if(options?.rootMargin)enter=fn;}observe(){}unobserve(){}disconnect(){}};
 const stop=installThumbnailLoading(win);
 try{
  const [direct,expensive]=win.document.images;assert.equal(direct.src,'https://publisher.test/photo.jpg');assert.equal(expensive.hasAttribute('src'),false);
  enter([{target:expensive,isIntersecting:true}]);assert.match(expensive.src,/og-image/);
 }finally{stop();win.close();}
});
test('desktop Glass watches the visible card even when its source image is hidden',{timeout:3000},async()=>{
 const dom=new JSDOM('<body><article class="article-card"><img style="display:none" data-thumbnail-src="/api/og-image?a"></article><article class="article-card"><img data-thumbnail-src="/api/og-image?b"></article><article class="article-card"><img data-thumbnail-src="/api/og-image?c"></article></body>',{url:'http://reader.test'});
 const win=dom.window,targets=[];let near,visible;
 win.IntersectionObserver=class{constructor(fn,options){if(options?.rootMargin)near=fn;else visible=fn;}observe(target){targets.push(target);}unobserve(){}disconnect(){}};
 const stop=installThumbnailLoading(win);
 try{
  const images=[...win.document.images],cards=[...win.document.querySelectorAll('article')];
  assert.deepEqual([...new Set(targets)],cards);
  near(cards.map(target=>({target,isIntersecting:true})));
  assert.ok(images[0].src,'hidden source must start without a resize');assert.ok(images[1].src);assert.equal(images[2].hasAttribute('src'),false);
  near([{target:cards[0],isIntersecting:false}]);
  assert.ok(images[0].getAttribute('src'),'an in-flight image must not be cancelled solely by leaving the preload margin');
  visible([{target:cards[2],isIntersecting:true}]);
  assert.ok(images[0].hasAttribute('src'),'visible admission must not blank an existing source');
  assert.ok(images[2].src,'a visible request uses the bounded reserve behind slow preloads');
 }finally{stop();win.close();}
});

test('rapid scroll reversal preserves an in-flight thumbnail when no visible work is waiting',{timeout:3000},async()=>{
 const dom=new JSDOM('<body><article class="article-card"><img data-thumbnail-src="/api/og-image?a"></article></body>',{url:'http://reader.test'});
 const win=dom.window;let near,visible;
 win.IntersectionObserver=class{constructor(fn,options){if(options?.rootMargin)near=fn;else visible=fn;}observe(){}unobserve(){}disconnect(){}};
 const [img]=win.document.images,card=img.closest('.article-card'),stop=installThumbnailLoading(win);
 try{
  near([{target:card,isIntersecting:true}]);
  const initial=img.getAttribute('src');assert.ok(initial);
  near([{target:card,isIntersecting:false}]);
  visible([{target:card,isIntersecting:false}]);
  assert.equal(img.getAttribute('src'),initial,'scrolling out must not blank the photo');
  near([{target:card,isIntersecting:true}]);
  visible([{target:card,isIntersecting:true}]);
  assert.equal(img.getAttribute('src'),initial,'returning must reuse the ongoing request');
  img.dispatchEvent(new win.Event('load'));await tick();
  near([{target:card,isIntersecting:false}]);
  assert.equal(img.getAttribute('src'),initial,'decoded source remains mounted after scrolling away');
 }finally{stop();win.close();}
});
