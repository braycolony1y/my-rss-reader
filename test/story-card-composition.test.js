import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { organicPhotoMask, deriveStoryComposition, storyPhotoSource } from '../public/top-story-card/blend/composition.js';
import { placeStoryHero } from '../public/top-story-card/blend/placement.js';
import { placeDesktopPhoto, intrinsicPhotoAnalysis } from '../public/top-story-card/blend/desktop-photo.js';
const photo = { w:1200, h:630, focal:{x:.416,y:.5,w:.15,h:.2,kind:'saliency'},
    avgL:.65, clusters:[{x:.2,y:.4,pop:.48,L:.86,C:.015,H:150},{x:.8,y:.5,pop:.5,L:.45,C:.07,H:245}] };
// Render native elliptical gradient parameters with an independent SVG rasterizer.
const svg = value => {
    if (value.startsWith('url(')) return Buffer.from(decodeURIComponent(value.slice(value.indexOf(',') + 1, -2)));
    const [,rx,ry,cx,cy]=value.match(/ellipse ([\d.]+)% ([\d.]+)% at ([\d.]+)% ([\d.]+)%/).map(Number);
    const stops=[...value.matchAll(/(#000|transparent|rgb\(0 0 0 \/ ([\d.]+)\)) ([\d.]+)%/g)]
        .map(([,color,alpha,offset])=>`<stop offset="${Number(offset)/100}" stop-color="white" stop-opacity="${color==='transparent'?0:alpha??1}"/>`).join('');
    return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" preserveAspectRatio="none"><defs><radialGradient id="m" gradientUnits="userSpaceOnUse" cx="${cx*10}" cy="${cy*10}" r="${rx*10}" gradientTransform="translate(${cx*10} ${cy*10}) scale(1 ${ry/rx}) translate(${-cx*10} ${-cy*10})">${stops}</radialGradient></defs><rect width="1000" height="1000" fill="url(#m)"/></svg>`);
};

test('the curved detail contour preserves the ship and has no straight left fade', async () => {
    const image = await sharp(svg(organicPhotoMask())).resize(600,315,{fit:'fill'}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const alpha = (x,y) => image.data[(Math.floor(y*image.info.height)*image.info.width + Math.floor(x*image.info.width))*4+3];
    assert.ok(alpha(.77,.48)>=250,'Ship stays inside the clear region');
    const depths = [.16,.45,.7].map(y=>alpha(.17,y));
    assert.ok(Math.max(...depths)-Math.min(...depths)>30,'Fade depth changes along the image edge');
    assert.ok(alpha(.75,.99)<60,'Detail dissolves before the source ends');
    for (const soft of [false,true]) {
        const {data,info}=await sharp(svg(organicPhotoMask({soft}))).resize(600,315,{fit:'fill'}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
        const column=y=>data[(y*info.width+510)*4+3];
        assert.ok(new Set(Array.from({length:75},(_,i)=>column(240+i))).size>12,'The narrow feather has a gradual alpha transition');
        assert.equal(column(info.height-1),0,'No visible rectangular lower source boundary');
        assert.ok(column(Math.floor(info.height*.84))>=245,'The lower photograph survives until the narrow feather');
    }
});

test('desktop anchor translates a constant-size intrinsic photo beyond the rounded card edge', () => {
    for (const [w,h] of [[1200,630],[600,315],[800,450],[800,606]]) {
        const a={...photo,w,h};
        const p=placeStoryHero(a,{width:1000,height:530,panelTop:.66,headingRight:.57});
        assert.equal(p.imageW,660); assert.equal(p.imageH,660*h/w);
        assert.equal(p.offsetX,480); assert.equal(p.offsetY,0); assert.equal(p.scale,1);
        assert.equal(p.offsetX+p.imageW,1140,'The card clips the intentional overflow');
        const translated=placeDesktopPhoto(a,{width:1000,height:530,left:.42});
        assert.equal(translated.imageW,p.imageW); assert.equal(translated.imageH,p.imageH);
        assert.equal(translated.fitScale,p.fitScale,'Translation never alters zoom');
        const expanded=placeStoryHero(a,{width:1000,height:1200,panelTop:.9});
        assert.equal(expanded.imageW,p.imageW); assert.equal(expanded.imageH,p.imageH,'Expanding analysis never resizes the photo');
    }
});

test('decoded photograph dimensions take precedence over resized analysis dimensions', () => {
    const native=intrinsicPhotoAnalysis(photo,{naturalWidth:800,naturalHeight:450});
    assert.equal(native.w,800); assert.equal(native.h,450);
    assert.equal(native.focal,photo.focal,'Existing focal analysis is preserved');
    assert.equal(intrinsicPhotoAnalysis(photo,{naturalWidth:0,naturalHeight:0}),photo);
    const artwork={...photo,crop:[.05,.05,.05,.05]};
    assert.equal(intrinsicPhotoAnalysis(artwork,{naturalWidth:800,naturalHeight:450}),artwork);
});

test('image-derived spatial tones stay luminous for extreme photos and neutral without colors', () => {
    const p=placeStoryHero(photo,{width:1000,height:530});
    const a=deriveStoryComposition(photo,{p,width:1000});
    assert.notEqual(a['--field-land'],a['--field-ocean']);
    for(const avgL of [0,1]) {
        const tokens=deriveStoryComposition({...photo,avgL,clusters:[]},{p,width:1000});
        assert.ok(Number(tokens['--field-exposure'])>=1.12 && Number(tokens['--field-exposure'])<=1.42);
        assert.match(tokens['--field-land'],/0\.00000/,'Missing samples do not invent saturation');
    }
});

test('original photographs reuse their configured thumbnail URL and framed artwork keeps its crop', () => {
    const img={src:'https://example.com/thumbnail.png',currentSrc:'https://example.com/thumbnail-2x.png'};
    assert.equal(storyPhotoSource(img,photo,'baked'),img.currentSrc);
    assert.equal(storyPhotoSource(img,{...photo,crop:[.05,.05,.05,.05]},'baked'),'baked');
    assert.equal(storyPhotoSource({src:'javascript:alert(1)'},photo,'baked'),'baked');
});
