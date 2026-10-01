import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {areaLabGrid,normalizeAmbient,blendTokens,rgbToOklab} from '../public/card-blend/color.js';
import {SMOOTHERSTEP,maskProperties} from '../public/card-blend/masks.js';
import {buildCardBlendAssets} from '../src/images/card-blend/assets.js';
test('ambient area averaging happens in OKLab before resizing',()=>{
 const [cell]=areaLabGrid(Uint8Array.from([0,0,0,255,255,255]),2,1,3,1,1);
 assert.ok(Math.abs(cell[0]-.5)<1e-7);
 assert.ok(Math.abs(cell[0]-rgbToOklab(128,128,128)[0])>.09);
 const [weighted]=areaLabGrid(Uint8Array.from([0,0,0,0,255,255,255,255]),2,1,4,1,1);
 assert.ok(Math.abs(weighted[0]-1)<1e-7,'transparent cells do not darken the ambient');
});
test('normalization lifts dark/grayscale images while retaining bounded chromatic variation',()=>{
 const grid=Array.from({length:384},(_,i)=>[i%24/30,0,0]);
 const result=normalizeAmbient(grid);
 assert.equal(result.h_ref,250);assert.ok(result.k>=0&&result.k<=1);
 assert.ok(result.cells.every(c=>c.L>=.9&&c.L<=.955&&c.C>=.049&&c.C<=.085));
 assert.match(blendTokens(result)['--tb'],/^oklch\(.962 0.03 /);
});
test('mask ramps have eleven monotonic eased stops and keep the clear region outside the seam',()=>{
 assert.equal(SMOOTHERSTEP.length,11);assert.equal(SMOOTHERSTEP[0],0);assert.equal(SMOOTHERSTEP.at(-1),1);
 assert.ok(SMOOTHERSTEP.every((v,i)=>i===0||v>=SMOOTHERSTEP[i-1]));
 assert.ok(maskProperties(1)['--plate-x'].endsWith('rgba(0,0,0,1) 60%)'));
 assert.ok(maskProperties(0)['--plate-x'].endsWith('rgba(0,0,0,1) 50%)'));
 assert.ok(maskProperties(1)['--melt-y'].includes('var(--fy) + 24px'));
});
test('ambient and melt are pre-rendered bounded WebP assets with cached metadata',async()=>{
 const input=await sharp({create:{width:480,height:320,channels:3,background:'#26332a'}}).png().toBuffer();
 const result=await buildCardBlendAssets(input);
 const ambient=await sharp(Buffer.from(result.ambientImage.split(',')[1],'base64')).metadata();
 const melt=await sharp(Buffer.from(result.meltImage.split(',')[1],'base64')).metadata();
 assert.equal(ambient.width,96);assert.equal(ambient.height,64);assert.equal(melt.width,320);
 assert.ok(result.edgeL<.4&&result.k>.9);
 assert.ok(result.assetBytes.ambient<4096&&result.assetBytes.melt<20000);
});
