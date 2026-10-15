import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {collectImageFocusMutations, applyImageFocusMutations} from '../public/image-focus-mutations.js';
test('photo style writes do not feed back into focus; source and content layout changes still update',()=>{
 const dom=new JSDOM('<div class="article-card"><div class="article-card-image"><div class="thumbnail-plate"><img class="thumbnail-img"></div></div><div class="article-card-heading">Title</div></div>');
 const doc=dom.window.document,card=doc.querySelector('.article-card'),img=doc.querySelector('img'),plate=img.parentElement,heading=doc.querySelector('.article-card-heading');
 const attribute=(target,attributeName)=>({type:'attributes',target,attributeName});
 assert.equal(collectImageFocusMutations([attribute(plate,'style'),attribute(card,'style'),attribute(img,'style')],'.thumbnail-img').images.size,0);
 for(const record of [attribute(img,'src'),attribute(img,'srcset'),attribute(heading,'class'),attribute(card,'data-image-layout')])assert.ok(collectImageFocusMutations([record],'.thumbnail-img').images.has(img));
 const changed=collectImageFocusMutations([{type:'childList',target:card,addedNodes:[heading,img,plate],removedNodes:[]}],'.thumbnail-img');assert.deepEqual(changed.added,[heading,plate]);
 dom.window.close();
});

test('insertion and source mutations paint a new photo once; existing content still updates and removals release', () => {
 const dom=new JSDOM('<main><div class="article-card"><div class="article-card-image"><img class="thumbnail-img"></div><h2>Title</h2></div></main>');
 const doc=dom.window.document,card=doc.querySelector('.article-card'),img=doc.querySelector('img'),heading=doc.querySelector('h2');
 const states=new Map(), painted=[];
 const update=image=>painted.push(image);
 const watch=image=>{if(!states.has(image)){states.set(image,{source:'current'});update(image);}};
 const scan=node=>{if(node.matches('.thumbnail-img'))watch(node);node.querySelectorAll('.thumbnail-img').forEach(watch);};
 const options={selector:'.thumbnail-img',states,watch,scan,update,release:image=>states.delete(image)};
 const attr=(target,attributeName)=>({type:'attributes',target,attributeName});
 applyImageFocusMutations([{type:'childList',target:doc.querySelector('main'),addedNodes:[card],removedNodes:[]},attr(img,'src'),attr(img,'srcset'),attr(heading,'class')],options);
 assert.deepEqual(painted,[img]);assert.equal(states.get(img).source,'current');
 painted.length=0;
 applyImageFocusMutations([attr(img,'src'),attr(heading,'class')],options);
 assert.deepEqual(painted,[img]);assert.equal(states.get(img).source,'current');
 card.remove();applyImageFocusMutations([{type:'childList',target:doc.querySelector('main'),addedNodes:[],removedNodes:[card]}],options);
 assert.equal(states.size,0);dom.window.close();
});

test('identical source assignments do no image work, while sizes changes remain observable', () => {
 const dom = new JSDOM('<img class="thumbnail-img" src="a.jpg" srcset="a.jpg 1x" sizes="50vw">');
 const img = dom.window.document.querySelector('img');
 const records = ['src','srcset','sizes'].map(attributeName => ({type:'attributes',target:img,attributeName,oldValue:img.getAttribute(attributeName)}));
 assert.equal(collectImageFocusMutations(records,'.thumbnail-img').images.size,0);
 records[2].oldValue='100vw';
 assert.ok(collectImageFocusMutations(records,'.thumbnail-img').images.has(img));
 dom.window.close();
});
