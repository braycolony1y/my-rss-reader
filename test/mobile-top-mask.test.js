import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { directImageMask } from '../public/top-story-card/mobile-top-layout.js';

test('mobile photo alpha makes a broad smooth transition while preserving the upper image', async () => {
 for (const width of [294,349,364,388,404,414,741]) {
  const height = Math.round(width * 9 / 16);
  const mask = directImageMask(width,height);
  const svg = decodeURIComponent(mask.slice(mask.indexOf(',') + 1,-2));
  const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const alpha = (x,y) => data[(y*info.width+x)*4+3];
  const edges=[];
  for (let x=0; x<width; x+=Math.max(1,Math.floor(width/10))) {
   assert.ok(alpha(x,Math.floor(height*.69))>=254,'the photo remains clear until the transition near the title');
   assert.ok(alpha(x,0)>=254,'no top/side fading');
   assert.ok(alpha(x,height-1)<=3,'no visible alpha at physical bottom');
   let fading = 0;
   for (let y=1; y<height; y++) {
    assert.ok(alpha(x,y)<=alpha(x,y-1),'fade never reverses or creates a second edge');
    if (alpha(x,y)>25 && alpha(x,y)<230) fading++;
   }
   assert.ok(fading>=height*.14,'the lowered fade remains smooth instead of becoming a narrow seam');
   let y=0;while(y<height && alpha(x,y)>128)y++;edges.push(y);
  }
  assert.ok(Math.max(...edges)-Math.min(...edges)<=1,'the transition stays even across the image');
 }
});
