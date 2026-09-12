import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createAntigravityProvider, parseAntigravityOutput } from '../src/ai/antigravity.js';
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
 await assert.rejects(generate('sensitive prompt'),/Antigravity request failed \(ENOENT\)/);
 await assert.rejects(generate('sensitive prompt'),/cooling down/);assert.equal(calls,1);
 time=201;await assert.rejects(generate('sensitive prompt'),/request failed/);assert.equal(calls,2);
});
test('busy and missing CLI calls promptly yield to the API backup',async()=>{
 const absent=createAntigravityProvider({available:()=>false});await assert.rejects(absent('input'),/not available/);
 let finish;const generate=createAntigravityProvider({available:()=>true,run:(binary,args,options,callback)=>{finish=callback;return{pid:0}}});
 const first=generate('first');
 await assert.rejects(generate('second'),/busy/);
 while(!finish)await new Promise(r=>setImmediate(r));finish(null,success);await first;
});
test('both production AI paths prioritize Antigravity before Gemini',async()=>{
 const summary=await readFile(new URL('../summary-engine.js',import.meta.url),'utf8');
 const smart=await readFile(new URL('../smart-news.js',import.meta.url),'utf8');
 const chain=summary.slice(summary.indexOf('async function generateWithFallback'));
 assert.ok(chain.indexOf('await generateWithAntigravity')<chain.indexOf('await geminiGenerate'));
 assert.ok(smart.indexOf("id: 'antigravity'")<smart.indexOf("id: 'gemini-flash-lite'"));
 assert.match(smart,/providers\.splice\(providers\[0\]\?\.type === 'antigravity' \? 1 : 0/);
});
