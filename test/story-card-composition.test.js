import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { deriveStoryComposition, storyPhotoSource } from '../public/top-story-card/blend/composition.js';
import { placeStoryHero } from '../public/top-story-card/blend/placement.js';
import { placeDesktopPhoto, intrinsicPhotoAnalysis } from '../public/top-story-card/blend/desktop-photo.js';
import { desktopLeftMask, desktopBottomMask } from '../public/top-story-card/blend/organic-envelope.js';
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

test('independent left and lower masks retain detail and finish before physical photo edges', async () => {
    for (const soft of [false, true]) {
        const raster = value => sharp(svg(value)).resize(600, 600, {fit:'fill'}).ensureAlpha().png().toBuffer();
        const left = await raster(desktopLeftMask({soft}));
        const bottom = await raster(desktopBottomMask({soft}));
        const {data,info} = await sharp(left).composite([{input:bottom,blend:'dest-in'}]).raw().toBuffer({resolveWithObject:true});
        const alpha = (x,y) => data[(Math.floor(y*info.height)*info.width+Math.floor(x*info.width))*4+3];
        assert.equal(alpha(.85,0),255, 'No filter clipping at the upper photo edge');
        assert.ok(alpha(.77,.48)>=250, 'The main photographic region stays crisp');
        assert.ok(alpha(.85,.84)>=245, 'Useful lower photo content is retained');
        const leftDepths = [.03,.42,.85].map(y=>alpha(.17,y));
        assert.ok(Math.max(...leftDepths)-Math.min(...leftDepths)>5, 'Left fade varies vertically');
        for (let x=0; x<info.width; x++) {
            assert.equal(data[((info.height-1)*info.width+x)*4+3],0, 'Whole physical bottom edge is transparent');
        }
        const b = await sharp(bottom).toColourspace('srgb').ensureAlpha().raw().toBuffer();
        const halfAlpha = x => Array.from({length:600},(_,y)=>y).find(y=>b[(y*600+Math.floor(x*600))*4+3]<128);
        const contour = [.05,.5,.9].map(halfAlpha);
        assert.ok(contour.every(y => y >= 600 * .94), 'The shortened feather stays near the bottom');
        for (let x=0; x<600; x++) assert.equal(b[(551*600+x)*4+3],255, 'Upper 92% stays opaque');
        assert.ok(contour[1]-contour[0]>=3 && contour[2]>=contour[1], 'The lower contour curves down toward the right');
        assert.ok(new Set(Array.from({length:100},(_,i)=>alpha(.85,(500+i)/600))).size>12, 'Lower feather has a gradual alpha transition');
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

test('alpha pixels do not bypass desktop framing or reset the resolved focus', () => {
    const source = { ...photo, hasTransparency: true, graphic: true };
    for (const width of [640, 800, 1100]) {
        const framed = placeStoryHero(source, { width, height: 530 });
        const ordinary = placeStoryHero(photo, { width, height: 530 });
        assert.equal(framed.placement, 'editorial');
        for (const key of ['offsetX', 'offsetY', 'imageW', 'imageH', 'posX', 'posY', 'scale']) {
            assert.equal(framed[key], ordinary[key], `${width}/${key}`);
        }
        assert.equal(framed.posX, photo.focal.x * 100);
        assert.equal(framed.posY, photo.focal.y * 100);
    }
    assert.equal(placeStoryHero(source, { width: 390, height: 530 }).placement, 'stacked');
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
