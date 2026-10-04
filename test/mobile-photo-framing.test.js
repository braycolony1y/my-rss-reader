import test from 'node:test';
import assert from 'node:assert/strict';
import {placeMobilePhoto} from '../public/top-story-card/mobile-photo-framing.js';
test('faces remain below the metadata and above the feather at all mobile widths',()=>{
 for(const width of [294,349,364,388,406,741])for(const dimensions of [[800,450],[450,800],[1600,500]]){
  const height=width*9/16,bounds={left:.4,right:.6,top:.2,bottom:.4};
  const p=placeMobilePhoto({sourceWidth:dimensions[0],sourceHeight:dimensions[1],width,height,railBottom:48,subject:{bounds,x:.5,y:.3}});
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
