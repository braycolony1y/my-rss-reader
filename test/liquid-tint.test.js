import test from 'node:test';
import assert from 'node:assert/strict';
import {extractLiquidTint,tintProperties,rgbToOklab} from '../public/liquid-tint.js';
function pixels(edge,full=edge){const data=Buffer.alloc(64*64*3);for(let y=0;y<64;y++)for(let x=0;x<64;x++)data.set(x<13?edge:full,(y*64+x)*3);return data;}
test('OKLab conversion matches reference white, black and red',()=>{
 assert.ok(Math.abs(rgbToOklab(255,255,255)[0]-1)<1e-7);
 assert.deepEqual(rgbToOklab(0,0,0),[0,0,0]);
 assert.ok(Math.abs(rgbToOklab(255,0,0)[0]-.627955)<1e-6);
});
test('seam sampling ignores borders and the subject outside the seam, and uses P90 chroma',()=>{
 const data=pixels([200,225,215],[200,225,215]);
 for(let y=0;y<64;y++)for(let x=0;x<64;x++) {
  if(x<6)data.set([255,255,255],(y*64+x)*3);
  if(x>=29)data.set([210,130,60],(y*64+x)*3);
 }
 const t=extractLiquidTint(data,64,64,3), lab=rgbToOklab(200,225,215);
 assert.ok(Math.abs(t.h1-(Math.atan2(lab[2],lab[1])*180/Math.PI+360)%360)<1);
 assert.ok(Math.abs(t.cs-Math.hypot(lab[1],lab[2]))<.001);
});
test('three seam bands inherit gray neighbors and smooth adjacent hue differences',()=>{
 const data=pixels([160,160,160]);
 for(let y=0;y<64;y++)for(let x=6;x<29;x++)data.set(y<22?[190,25,50]:y<43?[160,160,160]:[35,140,70],(y*64+x)*3);
 const t=extractLiquidTint(data,64,64,3);
 const delta=(a,b)=>Math.abs((a-b+540)%360-180);
 assert.ok(t.cs1>.15,'saturated curtain wins the first band');
 assert.equal(t.cs2,t.cs1,'gray middle band inherits the nearest colored band');
 assert.ok(delta(t.h1,t.h2)<=20 && delta(t.h2,t.h3)<=20);
 const css=tintProperties(t);
 assert.match(css['--ta-3'],/^oklch\(0\.93 /);
 assert.equal(css['--liquid-image-width'],'58%');
 assert.match(css['--accent'],/^oklch\(0\.48 0\.11 /);
 const white=tintProperties(extractLiquidTint(pixels([255,255,255]),64,64,3));
 assert.equal(white['--liquid-image-width'],'48%');
});
test('gray fallback and fixed hue-locked tokens',()=>{
 for(const gray of [0,128,255])assert.equal(extractLiquidTint(pixels([gray,gray,gray]),64,64,3).cs,.03);
 for(const h1 of [90,120,152,250,355]) {
  const css=tintProperties({h1,cs:.1,edgeL:.7});
  assert.match(css['--tint-a'],/^oklch\(0\.93 /);
  assert.match(css['--tint-b'],/^oklch\(0\.962 /);
  assert.equal(css['--tint-lift'],'0.30');
  assert.equal(Number(css['--tint-a'].split(' ')[1]),h1>=85&&h1<=135?.05:.075);
 }
 assert.match(tintProperties({h1:355,secondaryHue:5,cs:.06,edgeL:.2})['--tint-b'],/ 5\)$/);
});
