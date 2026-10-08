import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {installImageFocus} from '../public/image-focus.js';
import {shouldApplyImageFocus} from '../public/image-focus-visibility.js';
test('deferred Glass photo work still initializes the exact shared text layout',()=>{
    const dom=new JSDOM('<div class="theme-glass-light"><div class="article-card" data-image-layout="standard"><img></div></div>');
    const img=dom.window.document.querySelector('img'),card=img.parentElement;
    Object.defineProperty(card,'clientWidth',{value:832});
    assert.equal(shouldApplyImageFocus({near:false},img),false);
    assert.equal(card.dataset.sharedCardStyle,'desktop');
    assert.equal(card.dataset.storyBlend,'fallback');
    dom.window.close();
});
test('offscreen cards defer photo work and retain focus after admission, resize and return',()=>{
    const dom=new JSDOM('<div class="article-card" data-image-layout="standard"><div class="article-card-image"><img class="thumbnail-img" src="/public/default.jpg"></div></div>',{url:'https://reader.example.test'});
    const win=dom.window,img=win.document.querySelector('img'),card=img.closest('.article-card'),observers=[];
    win.IntersectionObserver=class {
        constructor(callback,options){this.callback=callback;this.options=options;observers.push(this);}
        observe(target){this.target=target;} unobserve(){} disconnect(){}
    };
    Object.defineProperties(img,{complete:{value:true},naturalWidth:{value:800},naturalHeight:{value:450},clientWidth:{value:400},clientHeight:{value:200}});
    win.fetch=()=>assert.fail('Local fallback must not need network');
    const stop=installImageFocus(win),near=observers.find(o=>o.options?.rootMargin==='1600px 0px');
    assert.equal(near.target,card,'the visible card admits a hidden source thumbnail');
    assert.equal(img.style.getPropertyValue('--image-focus-fit'),'');
    near.callback([{target:card,isIntersecting:true}]);
    assert.equal(img.dataset.focusState,'ready');
    const position=img.style.getPropertyValue('--image-focus-x');
    near.callback([{target:card,isIntersecting:false}]);
    win.dispatchEvent(new win.Event('resize'));
    near.callback([{target:card,isIntersecting:true}]);
    assert.equal(img.style.getPropertyValue('--image-focus-x'),position);
    stop();dom.window.close();
});
