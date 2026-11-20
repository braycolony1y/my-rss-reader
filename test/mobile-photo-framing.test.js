import test from 'node:test';
import assert from 'node:assert/strict';
import {placeMobilePhoto,mobilePhotoHeight} from '../public/top-story-card/mobile-photo-framing.js';
test('faces remain below the metadata and above the feather at all mobile widths',()=>{
 for(const width of [294,349,364,388,406])for(const dimensions of [[800,450],[450,800],[1600,500]]){
  const height=mobilePhotoHeight(width),bounds={left:.4,right:.6,top:.2,bottom:.4};
  const p=placeMobilePhoto({sourceWidth:dimensions[0],sourceHeight:dimensions[1],width,height,railBottom:48,subject:{bounds,x:.5,y:.3}});
  assert.equal(p.boxHeight,height);
  assert.ok(p.x<=0 && p.y<=0);
  assert.ok(p.x+p.width>=width-.001);
  assert.ok(p.y+p.height>=p.boxHeight-.001);
  assert.ok(p.y+bounds.top*p.height>=56-.001);
  assert.ok(p.y+bounds.bottom*p.height<=p.boxHeight*.84+.001);
  assert.ok(p.x+bounds.left*p.width>=-.001);
  assert.ok(p.x+bounds.right*p.width<=width+.001);
 }
});
test('images without a detected face retain their original crop',()=>{
 assert.equal(placeMobilePhoto({sourceWidth:800,sourceHeight:450,width:364,height:205,railBottom:48,subject:{x:.5,y:.5}}),null);
});
test('mobile photo height is fixed regardless of image aspect ratio',()=>{
 assert.equal(mobilePhotoHeight(390),242);
 assert.equal(mobilePhotoHeight(320),240);
 assert.equal(mobilePhotoHeight(767),280);
 const tall=placeMobilePhoto({sourceWidth:900,sourceHeight:1600,width:358,height:242,railBottom:48,subject:{bounds:{left:.3,right:.7,top:.15,bottom:.45},x:.5,y:.3}});
 assert.equal(tall.boxHeight,242);
});
