import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
 createAntigravityProvider,
 parseAntigravityOutput,
 withAntigravityRequestContext,
 touchAntigravityBriefingFocus,
 clearAntigravityBriefingFocus
} from '../src/ai/antigravity.js';
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
test('provider slots stay available while the global scheduler owns briefing priority', async () => {
 const callbacks = [];
 const generate = createAntigravityProvider({available: () => true, maxConcurrent: 2,
  run: (_binary, _args, _options, callback) => {callbacks.push(callback); return {pid: 0};}});
 const waitFor = async count => {
  for (let i = 0; callbacks.length < count && i < 200; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(callbacks.length, count);
 };
 const first = generate('old-a'), second = generate('old-b');
 await waitFor(2);
 touchAntigravityBriefingFocus('test-viewer');
 const briefing = withAntigravityRequestContext({type: 'story-briefing', isInteractive: () => true}, () => generate('visible-briefing'));
 const other = generate('other-ai');
 try {
  callbacks[0](null, success); await first;
  await waitFor(3);
  callbacks[1](null, success); await second;
  await waitFor(4);
  callbacks[2](null, success); callbacks[3](null, success);
  await Promise.all([briefing, other]);
 } finally { clearAntigravityBriefingFocus('test-viewer'); }
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
test('both production AI paths prioritize Antigravity before Gemini',async()=>{
 const summary=await readFile(new URL('../summary-engine.js',import.meta.url),'utf8');
 const smart=await readFile(new URL('../smart-news.js',import.meta.url),'utf8');
 const chain=summary.slice(summary.indexOf('async function generateWithFallback'));
 assert.ok(chain.indexOf('await generateWithAntigravity')<chain.indexOf('await geminiGenerate'));
 const low=smart.indexOf("id: 'antigravity-low'");
 const medium=smart.indexOf("id: 'antigravity-medium'");
 const high=smart.indexOf("id: 'antigravity-high'");
 const api=smart.indexOf("id: 'gemini-flash'");
 const local=smart.indexOf("id: 'local-qwen'");
 assert.ok(low >= 0 && low < medium && medium < high && high < api && api < local);
 assert.match(smart,/id: 'antigravity-medium'[\s\S]*?'gemini-3\.8-flash-medium'/);
 assert.match(smart,/id: 'antigravity-high'[\s\S]*?'gemini-3\.8-flash-high'/);
 assert.match(smart,/id: 'gemini-flash-lite'[\s\S]*?enabled: false/);
 assert.match(smart,/const firstApiIndex = providers\.findIndex\(p => p\.type !== 'antigravity'\)/);
});

test('clustering retains raw formatting through the CLI boundary for safe recovery and one repair', async () => {
 const { requestClusteringDecision } = await import('../src/ai/clustering-json.js');
 for (const raw of ['```json\n{"ok":true}\n```', 'Here is the result: {"ok":true}', '{"ok":']) {
  let calls=0;const events={};
  const generate=createAntigravityProvider({available:()=>true,run:(_binary,args,_options,callback)=>{
   calls++;assert.ok(args.includes('--json-schema'));
   queueMicrotask(()=>callback(null,JSON.stringify({status:'SUCCESS',response:calls===1?raw:'{"ok":true}'})));return{pid:0};
  }});
  const result=await requestClusteringDecision({
   request:async prompt=>(await generate(prompt||'fixture decision',{json:false,schema:{type:'object'},operation:'cluster-verification'})).text,
   schema:{type:'object'},validate:value=>({valid:value?.ok===true}),onEvent:event=>{events[event]=(events[event]||0)+1;}
  });
  assert.deepEqual(result,{ok:true});assert.equal(calls,raw==='{"ok":'?2:1);
  if(raw.startsWith('```'))assert.equal(events.markdownFenceRecoveries,1);
 }
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
