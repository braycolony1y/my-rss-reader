import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createInteractiveReasons } from '../src/smart/feedback/interactive.js';
import { semantics as s } from '../src/smart/feedback/semantics.js';
const article={title:"Phó thủ tướng Hồ Quốc Dũng: Chuyển từ 'có hoạt động' sang 'có kết quả' đổi mới sáng tạo",link:'https://example.test/story',feedTitle:'VnExpress Digital',feedUrl:'https://example.test/rss',smartCategory:'tech_vietnam'};
const rejected=s.pool(article).map(r=>r.id);

test('suggestions come from the local rule pool only; exhausted requests never return rejected reasons and never call a model',async()=>{
 const suggest=createInteractiveReasons();
 const initial=await suggest({article});assert.equal(initial.reasons.length,4);
 const next=await suggest({article,rejected});assert.equal(next.reasons.length,0);assert.equal(next.exhausted,true);assert.equal(next.retryable,false);
 assert.match(next.message,/Other/);
 const typed=await suggest({article,input:'zzz qqq unintelligible'});assert.equal(typed.reasons.length,0);assert.equal(typed.retryable,false);
});
test('the interactive module no longer references any model provider',async()=>{
 const source=await readFile('src/smart/feedback/interactive.js','utf8');
 assert.doesNotMatch(source,/verification|ollama|qwen|schedule|runGlobalAiTask|callVerificationProvider/i);
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
