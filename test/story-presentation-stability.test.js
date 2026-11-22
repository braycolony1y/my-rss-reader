import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {applyTopStoryImage} from '../public/top-story-card/blend/runtime.js';

function fixture(){
 const dom=new JSDOM('<body class="theme-glass-light"><article class="article-card" data-image-layout="top"><div class="article-card-image"><img class="thumbnail-soft"><img class="thumbnail-img"></div></article></body>',{url:'https://reader.example.com'});
 const card=dom.window.document.querySelector('article'),img=card.querySelector('.thumbnail-img'),soft=card.querySelector('.thumbnail-soft');
 Object.defineProperties(card,{clientWidth:{value:800},clientHeight:{value:400}});
 card.getBoundingClientRect=()=>({x:0,y:0,left:0,top:0,right:800,bottom:400,width:800,height:400});
 return {dom,card,img,soft};
}

test('an unassigned queued thumbnail is not a failed image that collapses the card',()=>{
 const {dom,card,img}=fixture();
 try{
  assert.equal(img.complete,true);assert.equal(img.naturalWidth,0);
  applyTopStoryImage(img,{source:'',near:false,focus:{x:.5,y:.5}},{ready:false});
  assert.equal(card.dataset.storyImageMissing,'false');
 }finally{dom.window.close();}
});

test('a displayed story photo retains its soft source and presentation when it leaves the preload region',()=>{
 const {dom,card,img,soft}=fixture();
 try{
  img.src='/api/og-image?url=story';
  Object.defineProperties(img,{complete:{value:true},naturalWidth:{value:800},naturalHeight:{value:600}});
  const state={source:'/api/og-image?url=story',near:true,generation:1,settled:true,focus:{x:.5,y:.5}};
  applyTopStoryImage(img,state,{ready:true});
  const source=soft.getAttribute('src'),styles=card.style.cssText;
  assert.ok(source);
  state.near=false;applyTopStoryImage(img,state,{ready:true});
  assert.equal(soft.getAttribute('src'),source,'scrolling must not invalidate an assigned image surface');
  assert.equal(card.style.cssText,styles,'focus, mask, palette, and geometry stay unchanged');
  assert.equal(img.dataset.focusState,'ready');
 }finally{dom.window.close();}
});
