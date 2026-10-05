import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { withinPickerBudget } from '../src/smart/feedback/request-budget.js';
import { createInteractiveReasons } from '../src/smart/feedback/interactive.js';
import { semantics as s } from '../src/smart/feedback/semantics.js';
const article={title:"Phó thủ tướng Hồ Quốc Dũng: Chuyển từ 'có hoạt động' sang 'có kết quả' đổi mới sáng tạo",link:'https://example.test/story',feedTitle:'VnExpress Digital',feedUrl:'https://example.test/rss',smartCategory:'tech_vietnam'};
const rejected=s.pool(article).map(r=>r.id);
const provider={id:'fixture',type:'ollama',model:'fixture'};
const idle=()=>({active:null,pending:[]});

test('the entire scheduled suggestion request is bounded and a late callback cannot start AI', async()=>{
 let queued, calls=0;
 const suggest=createInteractiveReasons(null,{timeoutMs:20,providers:()=>[provider],localState:idle,schedule:(_,fn)=>{queued=fn;return new Promise(()=>{});},request:()=>{calls++;return '{}';}});
 const result=await suggest({article,rejected});
 assert.equal(result.retryable,true);assert.match(result.message,/too long/);assert.equal(calls,0);
 await queued();assert.equal(calls,0);
});
test('cancelled picker discards queued work without starting an AI call',async()=>{
 let queued,calls=0;const controller=new AbortController();
 const suggest=createInteractiveReasons(null,{timeoutMs:500,providers:()=>[provider],localState:idle,schedule:(_,fn)=>{queued=fn;return new Promise(()=>{});},request:()=>{calls++;}});
 const work=suggest({article,rejected,signal:controller.signal});await new Promise(r=>setImmediate(r));controller.abort();
 assert.equal((await work).retryable,true);await queued();assert.equal(calls,0);
});
test('cooling-down API keys and busy local compute do not enqueue a picker',async()=>{
 let enqueued=0;
 const manager={keys:[{status:'Rate Limited'}],getCurrentKeyObj:()=>null};
 const suggest=createInteractiveReasons(manager,{providers:hasKey=>{assert.equal(hasKey,false);return [provider];},localState:()=>({active:{label:'embeddings'},pending:[]}),schedule:()=>{enqueued++;}});
 const result=await suggest({article,rejected});assert.equal(enqueued,0);assert.equal(result.retryable,true);assert.equal(result.reasons.length,0);
});
test('provider deferral does not requeue an interactive picker',async()=>{
 let dispatches=0;
 const suggest=createInteractiveReasons(null,{providers:()=>[provider],localState:idle,schedule:(_,fn)=>{dispatches++;return fn();},request:async()=>{throw Object.assign(Error('deferred'),{code:'AI_PROVIDER_DEFERRED',retryAt:Date.now()+60000});}});
 assert.equal((await suggest({article,rejected})).retryable,true);assert.equal(dispatches,1);
});
test('valid local candidates avoid AI and unavailable expansion never returns rejected reasons',async()=>{
 let calls=0;const suggest=createInteractiveReasons(null,{providers:()=>[],request:()=>{calls++;}});
 const initial=await suggest({article});assert.equal(initial.reasons.length,4);assert.equal(calls,0);
 const next=await suggest({article,rejected});assert.equal(next.reasons.length,0);assert.equal(next.retryable,true);
});
test('provider budget includes queue time and successful expansion can be reused',async()=>{
 const suggestion=s.reason('Do not show generic aspirations',{dimension:'story_type',eventType:'generic_aspiration',scope:'tech_vietnam',strength:'narrow'});
 let calls=0;
 const suggest=createInteractiveReasons(null,{timeoutMs:300,providers:()=>[provider],localState:idle,schedule:async(_,fn)=>{await new Promise(r=>setTimeout(r,15));return fn();},request:async p=>{calls++;assert.ok(p.timeoutMs<300);return JSON.stringify({reasons:[suggestion]});}});
 assert.equal((await suggest({article,rejected})).reasons[0].label,suggestion.label);
 await suggest({article,rejected});assert.equal(calls,1);
});
async function picker(fetch) {
 const context=vm.createContext({console,crypto,SmartFeedbackSemantics:s,AbortController,setTimeout,clearTimeout,fetch,window:{innerWidth:1440,innerHeight:900},document:{querySelector:()=>null}});
 vm.runInContext(await readFile('public/js/smart/feedback-picker.js','utf8')+'\nReaderSmartFeedback.suggestionTimeoutMs=25;this.factory=ReaderSmartFeedback;',context);
 const ui=context.factory.create();Object.assign(ui,{selectedFilterType:'smart',selectedFilterValue:'tech_vietnam',usesTopStories:true,$nextTick:()=>{},articles:[article]});ui.openSmartFeedback(article);return ui;
}
test('client timeout recovers even if a network transport ignores abort; nothing is hidden or applied',async()=>{
 let calls=0;const ui=await picker(()=>{calls++;return new Promise(()=>{});});
 await ui.differentFeedbackReasons();assert.equal(ui.feedbackBusy,false);assert.match(ui.feedbackMessage,/too long/);assert.equal(ui.feedbackCanApply,false);assert.equal(ui.feedbackHidden.length,0);assert.equal(calls,1);
});
test('Other cancels pending regeneration immediately and stale output cannot replace the typed reason',async()=>{
 let finish,signal;const ui=await picker((url,opts)=>{signal=opts.signal;return new Promise(resolve=>{finish=resolve;});});
 const work=ui.differentFeedbackReasons();assert.equal(ui.feedbackBusy,'suggestions');
 ui.openOtherFeedback();assert.equal(ui.feedbackBusy,false);assert.equal(ui.feedbackSession.other,true);assert.equal(signal.aborted,true);
 ui.updateFeedbackText('Only major developments');
 finish({ok:true,json:async()=>({reasons:[s.reason('stale',{dimension:'topic',topic:'wrong',scope:'tech_vietnam',strength:'topic'})]})});await work;
 assert.equal(ui.feedbackSession.input,'Only major developments');assert.equal(ui.feedbackSession.displayed.length,0);assert.equal(ui.feedbackHidden.length,0);
});
test('Cancel and Escape paths abort in-flight suggestions and discard the session',async()=>{
 let signal;const ui=await picker((url,opts)=>{signal=opts.signal;return new Promise(()=>{});});
 const work=ui.differentFeedbackReasons();ui.cancelSmartFeedback();await work;
 assert.equal(signal.aborted,true);assert.equal(ui.feedbackSession,null);assert.equal(ui.feedbackBusy,false);
});
