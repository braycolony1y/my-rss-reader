import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { applyTopStoryImage, storyBlendState } from '../public/top-story-card/blend/runtime.js';
function fixture({ layout = 'top', theme = 'theme-glass-light' } = {}) {
    const dom = new JSDOM(`<div class="${theme}"><div class="article-card" data-image-layout="${layout}"><div class="article-card-image"><img class="thumbnail-soft" loading="lazy"><img class="thumbnail-img"></div></div></div>`);
    const card = dom.window.document.querySelector('.article-card'), img = card.querySelector('.thumbnail-img'), soft = card.querySelector('.thumbnail-soft');
    Object.defineProperties(card, { clientWidth:{value:800}, clientHeight:{value:540} });
    card.getBoundingClientRect = () => ({ left:0, top:0, width:800, height:540 });
    Object.defineProperties(img, { naturalWidth:{value:800}, naturalHeight:{value:606}, complete:{value:true} });
    let decoded = false;
    Object.defineProperties(soft, { naturalWidth:{get:() => decoded ? 800 : 0}, complete:{get:() => decoded} });
    const state = { source:'https://example.com/photo.avif', focus:{x:.5,y:.4}, near:true, settled:true };
    const analysis = { w:800, h:606, originalW:800, focal:{x:.48,y:.28,w:.18,h:.18,kind:'face'},
        avgL:.65, meanChroma:.077, hMean:67, hueCoherence:.98, busyness:347, clusters:[],
        bottomBand:{L:.8,C:.04,H:67}, assets:{heroImage:'data:image/webp;base64,AAAA',ambientImage:'data:image/webp;base64,AAAA'} };
    return { dom,card,img,soft,state,analysis,decode() { decoded = true; soft.dispatchEvent(new dom.window.Event('load')); } };
}
test('a hidden lazy soft layer loads nearby baked assets and activates after decode', () => {
    const f = fixture(); f.state.blend = { story:f.analysis };
    applyTopStoryImage(f.img, f.state);
    assert.equal(f.soft.loading, 'eager', 'Hidden layers cannot begin browser lazy loading');
    assert.equal(f.card.dataset.storyBlend, 'fallback');
    f.decode();
    assert.equal(f.card.dataset.storyBlend, 'ready');
    f.state.near = false; applyTopStoryImage(f.img, f.state);
    assert.equal(f.soft.hasAttribute('src'), false, 'Offscreen cards retain the asset gate');
});
test('late analysis replaces the generic palette even when legacy focal placement is deferred', () => {
    const f = fixture(); applyTopStoryImage(f.img, f.state);
    assert.equal(storyBlendState(f.card).analysis.hMean, 250);
    f.state.blend = { story:f.analysis }; f.state.deferred = { x:.48,y:.28 };
    applyTopStoryImage(f.img, f.state);
    assert.equal(storyBlendState(f.card).analysis.hMean, 67);
    assert.equal(f.soft.getAttribute('src'), f.analysis.assets.heroImage);
});
test('other card layouts and app themes keep their existing image treatment', () => {
    for (const options of [{layout:'standard'}, {theme:'theme-glass-dark'}]) {
        const f = fixture(options);
        assert.equal(applyTopStoryImage(f.img, f.state), false);
        assert.equal(f.card.dataset.storyBlend, undefined);
        assert.equal(f.soft.hasAttribute('src'), false);
    }
});

test('the photo uses one clear right region instead of individual face openings', () => {
    const f = fixture(); f.state.blend = {story:{...f.analysis,faces:[{left:.4,right:.6,top:.2,bottom:.4}]}};
    f.card.style.setProperty('--subject-scrim-mask','radial-gradient(ellipse,transparent,#000)');
    applyTopStoryImage(f.img,f.state);
    assert.equal(f.card.style.getPropertyValue('--subject-scrim-mask'),'');
    assert.equal(f.card.style.getPropertyValue('--hero-scale'),'1');
    assert.equal(f.card.style.getPropertyValue('--hero-opacity'),'1');
    assert.ok(parseFloat(f.card.style.getPropertyValue('--scrim-clear-at')) <= 64);
});
