import test from 'node:test';
import assert from 'node:assert/strict';
import {createAntigravityProvider} from '../src/ai/antigravity.js';

test('provider admission reserves slots before asynchronous preparation', {timeout:5000}, async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve;});let active=0,peak=0,calls=0;
 const generate=createAntigravityProvider({available:()=>true,maxConcurrent:2,
  quotaRuntime:{retryAt:0,lastCheckAt:Infinity,stateLoaded:true,startupCheckStarted:true,checkPromise:null},
  run:(_binary,_args,_options,callback)=>{calls++;active++;peak=Math.max(peak,active);gate.then(()=>{active--;callback(null,JSON.stringify({status:'SUCCESS',response:'ready'}));});return {pid:0};}});
 const jobs=Array.from({length:8},(_,i)=>generate('fixture-'+i));
 await new Promise(resolve=>setTimeout(resolve,100));release();await Promise.all(jobs);
 assert.equal(calls,8);assert.equal(peak,2,'no more than two processes may be admitted while preparation awaits');
});
