import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {collectImageFocusMutations} from '../public/image-focus-mutations.js';
test('photo style writes do not feed back into focus; source and content layout changes still update',()=>{
 const dom=new JSDOM('<div class="article-card"><div class="article-card-image"><div class="thumbnail-plate"><img class="thumbnail-img"></div></div><div class="article-card-heading">Title</div></div>');
 const doc=dom.window.document,card=doc.querySelector('.article-card'),img=doc.querySelector('img'),plate=img.parentElement,heading=doc.querySelector('.article-card-heading');
 const attribute=(target,attributeName)=>({type:'attributes',target,attributeName});
 assert.equal(collectImageFocusMutations([attribute(plate,'style'),attribute(card,'style'),attribute(img,'style')],'.thumbnail-img').images.size,0);
 for(const record of [attribute(img,'src'),attribute(img,'srcset'),attribute(heading,'class'),attribute(card,'data-image-layout')])assert.ok(collectImageFocusMutations([record],'.thumbnail-img').images.has(img));
 const changed=collectImageFocusMutations([{type:'childList',target:card,addedNodes:[heading,img,plate],removedNodes:[]}],'.thumbnail-img');assert.deepEqual(changed.added,[heading,plate]);
 dom.window.close();
});
