import test from 'node:test';
import { readSmartSource } from './helpers/smart-source.js';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
 createAntigravityProvider as providerFactory,
 parseAntigravityOutput
} from '../src/ai/antigravity.js';
const createAntigravityProvider = options => providerFactory({ ...options, quotaRuntime: {retryAt:0,lastCheckAt:Infinity,stateLoaded:true,startupCheckStarted:true,checkPromise:null} });
const success=JSON.stringify({status:'SUCCESS',response:'{"ok":true}',usage:{input_tokens:12,output_tokens:4,total_tokens:16}});

test('Antigravity response requires successful nonempty output and valid structured content',()=>{
 assert.equal(parseAntigravityOutput(success,true).text,'{"ok":true}');
 assert.equal(parseAntigravityOutput(success,true).usage.totalTokens,16);
 assert.throws(()=>parseAntigravityOutput('{"status":"ERROR","response":"message"}'));
 assert.throws(()=>parseAntigravityOutput('{"status":"SUCCESS","response":"not json"}',true));
});
test('CLI uses an isolated directory, safe argv and does not inherit application keys',async()=>{
 let seen;
 const generate=createAntigravityProvider({available:()=>true,run:(binary,args,options,callback)=>{seen={binary,args,options};queueMicrotask(()=>callback(null,success));return{pid:0}}});
 process.env.TEST_RSS_API_KEY='private-fixture';
 try {
  const result=await generate('Article with `literal` $(content)',{json:true});
  assert.equal(result.provider,'antigravity');
  assert.ok(seen.options.cwd.startsWith('/tmp/rss-ai-'));
  assert.equal(seen.options.env.TEST_RSS_API_KEY,undefined);
  assert.equal(seen.options.shell,undefined);
  assert.ok(seen.args.includes('--sandbox'));
  assert.ok(seen.args.includes('--disable-slash-commands'));
  assert.ok(!seen.args.includes('--dangerously-skip-permissions'));
  assert.match(seen.args.at(-1),/`literal` \$\(content\)/);
  await assert.rejects(readFile(seen.options.cwd),/ENOENT/);
 }finally{delete process.env.TEST_RSS_API_KEY}
});
test('failed requests enter a bounded cooldown and never expose the prompt in errors',async()=>{
 let calls=0,time=100;
 const generate=createAntigravityProvider({available:()=>true,now:()=>time,cooldownMs:100,run:(binary,args,options,callback)=>{calls++;queueMicrotask(()=>callback(Object.assign(new Error('sensitive prompt'),{code:'ENOENT'})));return{pid:0}}});
 await assert.rejects(generate('sensitive prompt'),error => error.code === 'ANTIGRAVITY_FAILED' && error.antigravityDetail?.exitCode === 'ENOENT' && !error.message.includes('sensitive prompt'));
 await assert.rejects(generate('sensitive prompt'),/cooling down/);assert.equal(calls,1);
 time=60101;await assert.rejects(generate('sensitive prompt'),/request failed/);assert.equal(calls,2);
});
test('provider slots respect the limit without assuming callback arrival order', {timeout:5000}, async () => {
 const callbacks = new Map();
 const generate = createAntigravityProvider({available: () => true, maxConcurrent: 2,
  run: (_binary, args, _options, callback) => {callbacks.set(args.at(-1).split('\n\n').at(-1), callback); return {pid: 0};}});
 const waitFor = async label => {
  const deadline = Date.now() + 1000;
  while (!callbacks.has(label) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(callbacks.has(label), `Provider did not start ${label}`);
 };
 const first = generate('old-a'), second = generate('old-b');
 await Promise.all([waitFor('old-a'), waitFor('old-b')]);
 const briefing = generate('visible-briefing');
 const other = generate('other-ai');
 try {
  callbacks.get('old-b')(null, success); await second;
  await waitFor('visible-briefing');
  assert.equal(callbacks.has('other-ai'), false);
  callbacks.get('old-a')(null, success); await first;
  // Global scheduling owns priority; focus must not create a second private
  // reservation that can deadlock an already-admitted global AI task.
  await waitFor('other-ai');
  callbacks.get('other-ai')(null, success);
  callbacks.get('visible-briefing')(null, success);
  await Promise.all([briefing, other]);
 } finally { /* nothing to release */ }
});
test('Antigravity cooldown is scoped to the failing model',async()=>{
 let time=100;const calls=[];
 const generate=createAntigravityProvider({available:()=>true,now:()=>time,cooldownMs:100,run:(_binary,args,_options,callback)=>{
  const model=args[args.indexOf('--model')+1];calls.push(model);
  queueMicrotask(()=>model==='gemini-3.8-flash-high'
   ? callback(Object.assign(new Error('high failed'),{code:1}))
   : callback(null,success));
  return{pid:0};
 }});
 await assert.rejects(generate('high',{model:'gemini-3.8-flash-high'}),error => error.code === 'ANTIGRAVITY_FAILED' && error.antigravityDetail?.exitCode === '1');
 const low=await generate('low',{model:'gemini-3.8-flash-low',json:true});assert.equal(low.modelUsed,'gemini-3.8-flash-low');
 await assert.rejects(generate('high again',{model:'gemini-3.8-flash-high'}),/cooling down/);
 assert.deepEqual(calls,['gemini-3.8-flash-high','gemini-3.8-flash-low']);
});
test('the summary path prioritizes Antigravity before Gemini',async()=>{
 const summary=await readFile(new URL('../summary-engine.js',import.meta.url),'utf8');
 const chain=summary.slice(summary.indexOf('async function generateWithFallback'));
 assert.ok(chain.indexOf('await generateWithAntigravity')<chain.indexOf('await geminiGenerate'));
 assert.doesNotMatch(summary,/local-?qwen|LocalQwen|noLocalQwen/i);
});

test('Antigravity permits the configured 180 second ceiling for high-effort review', async () => {
  let seen;
  const generate=createAntigravityProvider({available:()=>true,run:(binary,args,options,callback)=>{
    seen={args,options};queueMicrotask(()=>callback(null,success));return{pid:0};
  }});
  await generate('fixture',{model:'gemini-3.8-flash-high',timeoutMs:180000});
  const timeoutIndex=seen.args.indexOf('--print-timeout');
  assert.equal(seen.args[timeoutIndex+1],'180s');
  assert.equal(seen.options.timeout,181000);
});
