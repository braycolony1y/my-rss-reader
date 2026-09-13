import test from 'node:test';
import assert from 'node:assert/strict';
import { briefingSources, validateBriefing, createStoryBriefings, REQUIRED_ANALYSIS_REVIEW, ANALYSIS_VERSION } from '../src/articles/story-briefing.js';
import { storyRevision } from '../src/articles/story-ranking.js';
const article={clusterId:'event',link:'https://source.example/article',title:'Vendor fixes a critical router vulnerability',content:'The update fixes a remote code execution vulnerability. Network administrators should install the fixed firmware.',feedTitle:'Source',topStory:{material_version:1,timeline:[]}};
const sources=briefingSources(article);
const quote='Network administrators should install the fixed firmware.';
const review=labels=>REQUIRED_ANALYSIS_REVIEW.map(label=>({label,useful:labels.includes(label),reason:labels.includes(label)?'Adds distinct actionable understanding.':'No distinct supported information for this section.'}));
const output=(labels=['Why it matters','Who is affected','What to do'])=>({analysisReview:review(labels),sections:[{label:'What happened',text:'The vendor published fixed firmware.',evidence:[{sourceId:1,quote}]},...labels.map(label=>({label,text:quote,evidence:[{sourceId:1,quote}]}))]});
const until=async predicate=>{for(let i=0;i<100;i++){if(await predicate())return;await new Promise(r=>setTimeout(r,5));}throw Error('Timed out');};
function harness(options={},store={}) {const db={get:async k=>store[k],put:async(k,v)=>{store[k]=JSON.parse(v)}};return {store,service:createStoryBriefings({db,generate:async()=>JSON.stringify(output()),...options})};}
test('explicitly evaluates every required candidate and retains all selected sections',()=>{
 const result=validateBriefing(output(),sources,{requireAnalysisReview:true});
 assert.equal(result.analysisVersion,ANALYSIS_VERSION);
 assert.equal(result.analysisReview.length,8);
 assert.equal(result.sections.length,4);
 assert.equal(validateBriefing(output([]),sources,{requireAnalysisReview:true}).analysisVersion,ANALYSIS_VERSION);
 const missing=output();missing.analysisReview=[];
 assert.equal(validateBriefing(missing,sources,{requireAnalysisReview:true}).analysisVersion,0);
});
test('unsupported optional data chip cannot discard valid analysis',()=>{
 const value=output();value.keyFacts=[{text:'Unsupported 99% improvement',evidence:[{sourceId:1,quote}]}];
 const result=validateBriefing(value,sources,{requireAnalysisReview:true});
 assert.equal(result.sections.length,4);assert.deepEqual(result.keyFacts,[]);assert.equal(result.analysisVersion,ANALYSIS_VERSION);
 assert.equal(result.validationWarnings.length,1);
});
test('custom sections are allowed and selected missing sections require repair',()=>{
 const value=output(['Why it matters']);value.sections.push({label:'Upgrade compatibility',text:quote,evidence:[{sourceId:1,quote}]});
 value.analysisReview.push({label:'Upgrade compatibility',useful:true,reason:'Specific upgrade implications.'});
 assert.equal(validateBriefing(value,sources,{requireAnalysisReview:true}).analysisVersion,ANALYSIS_VERSION);
 value.analysisReview.find(r=>r.label==='What changed').useful=true;
 assert.equal(validateBriefing(value,sources,{requireAnalysisReview:true}).analysisVersion,0);
});
test('Timeline is explicitly considered and can use existing material events',()=>{
 const value=output([]);value.analysisReview.find(r=>r.label==='Timeline').useful=true;
 assert.equal(validateBriefing(value,sources,{requireAnalysisReview:true,timeline:[{},{}]}).analysisVersion,ANALYSIS_VERSION);
 assert.equal(validateBriefing(value,sources,{requireAnalysisReview:true}).analysisVersion,0);
});
test('invalid optional section preserves factual excerpt while marking analysis incomplete',()=>{
 const value=output();value.sections[1].evidence=[{sourceId:1,quote:'This quote was fabricated and is not in the source.'}];
 const result=validateBriefing(value,sources,{requireAnalysisReview:true});
 assert.equal(result.sections.length,3);assert.ok(result.analysisIssues.length);assert.equal(result.analysisVersion,0);
});
test('old excerpt-only cache is withheld until content policy is reevaluated',async()=>{
 let resolve,calls=0;const {service}=harness({generate:async()=>{calls++;await new Promise(r=>resolve=r);return JSON.stringify(output());}},{storyBriefings:{'tech_world:event:material:1':{sections:output([]).sections}}});
 const pending=await service.get(article,'tech_world');assert.equal(pending.status,'pending');assert.equal(pending.sections.length,0);assert.equal(pending.analysisStatus,'pending');
 await until(()=>resolve);resolve();await until(async()=> (await service.get(article,'tech_world')).status==='ready');
 assert.equal(calls,1);assert.equal((await service.get(article,'tech_world')).sections.length,4);
});
test('all requested cards get evaluated, visible cards precede queued look-ahead',async()=>{
 const order=[];let release;const {service}=harness({concurrency:1,generate:async(prompt)=>{const id=JSON.parse(prompt.split('SOURCES:\n')[1])[0].link;order.push(id);if(order.length===1)await new Promise(r=>release=r);return JSON.stringify(output());}});
 const cards=Array.from({length:5},(_,i)=>({...article,clusterId:`event${i}`,link:`https://source.example/${i}`}));
 await service.get(cards[0],'tech_world',{priority:2});await until(()=>release);
 for (const card of cards.slice(1))await service.get(card,'tech_world',{priority:0});
 await service.get(cards[4],'tech_world',{priority:2});release();
 await until(()=>order.length===5);
 assert.equal(order[1],cards[4].link);
 await until(async()=> (await service.get(cards[3],'tech_world')).status==='ready');
});
test('background generation uses available cached source details',async()=>{
 let prompt;const {service}=harness({loadSource:async()=>({content:article.content+' The supported product range includes router model Atlas.'}),generate:async p=>{prompt=p;return JSON.stringify(output());}});
 await service.get(article,'tech_world');await until(()=>prompt);
 assert.match(prompt,/router model Atlas/);
});
test('incomplete evaluation is repaired and provider failures remain observable',async()=>{
 let calls=0;const {service}=harness({generate:async()=>JSON.stringify(++calls===1?{sections:output([]).sections}:output())});
 await service.get(article,'tech_world');await until(async()=> (await service.get(article,'tech_world')).status==='ready');assert.equal(calls,2);
 const failed=harness({generate:async()=>{throw Error('Fixture provider unavailable')}}).service;
 await failed.get(article,'tech_world');await until(async()=> (await failed.get(article,'tech_world')).analysisStatus==='unavailable');
});

 test('queue reports actual work ahead and stage without fabricated percentages',async()=>{
 let release;const {service}=harness({concurrency:1,generate:async()=>{await new Promise(r=>release=r);return JSON.stringify(output());}});
 await service.get(article,'tech_world');await until(()=>release);
 const second={...article,clusterId:'second'};
 const queued=await service.get(second,'tech_world');assert.equal(queued.queueAhead,1);assert.equal(queued.generationState,'queued');assert.equal(queued.progressPercent,undefined);
 const active=await service.get(article,'tech_world');assert.equal(active.generationStage,'generating');assert.equal(active.queueAhead,undefined);
 release();
 });
 test('conflicting suspected counts cannot silently select the newer figure',()=>{
 const reports=[{id:1,name:'Hospital',link:'https://a.test',title:'Earlier report',text:'Hospital reported 133 suspected cases.'},{id:2,name:'Ministry',link:'https://b.test',title:'Later report',text:'Ministry reported 95 suspected cases.'}];
 const conflicts=[{claims:[{value:'133'},{value:'95'}]}];
 const value={sections:[{label:'What happened',text:'There were 95 suspected cases.',evidence:[{sourceId:2,quote:reports[1].text}]}]};
 assert.throws(()=>validateBriefing(value,reports,{conflicts}),/differing reported figures/);
 value.sections[0]={label:'What happened',text:'The hospital earlier reported 133 suspected cases, while the ministry reported 95; the difference remains unresolved.',evidence:reports.map(s=>({sourceId:s.id,quote:s.text}))};
 assert.equal(validateBriefing(value,reports,{conflicts}).sections.length,1);
 });
