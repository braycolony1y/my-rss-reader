import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { semantics as s } from '../src/smart/feedback/semantics.js';
import { getPersonalStore, confirmFeedback, undoFeedback, disableRule, filterPersonalArticles, matchPersonal, PERSONAL_STATE_KEY } from '../src/smart/feedback/store.js';
import { preparePersonalCandidates, bindPersonalState } from '../src/smart/feedback/pipeline.js';
import { extendAiReview, normalizeWithSideTask, primaryDecision, requestWithOptionalSideTask, acceptAiSideTask } from '../src/smart/prefilter/ai.js';
import { filterLog } from '../src/smart/feedback/log.js';
import { preparePrefilterCandidates } from '../src/smart/prefilter/boundaries.js';
import { filterPublishedSnapshot, prefilterWorkerState, workerPrefilterValues } from '../src/smart/prefilter/publication.js';
import { createReaderAssetRenderer } from '../src/ui/reader-assets.js';
const makeDb = (seed = {}) => { const data = new Map(Object.entries(seed)); return { writes: 0, async get(key) { const value = data.get(key); return typeof value === 'string' ? JSON.parse(value) : value; }, async put(key, value) { this.writes++; data.set(key, value); } }; };
const article = { title: 'VinFast monthly deliveries increase', link: 'https://example.test/vinfast/1', content: 'Monthly vehicle delivery numbers.', smartCategory: 'tech_vietnam', feedTitle: 'Example', feedUrl: 'https://example.test/rss' };
const reason = s.pool(article).find(r => r.rule.dimension === 'entity');
const confirm = (db, reasons = [reason], a = article, requestId = crypto.randomUUID()) => confirmFeedback(db, { article: a, surface: 'classic', selectedReasons: reasons, requestId });

test('no selection cannot persist; store loading, suggestions, interpretation are read-only', async () => {
 const db = makeDb(); await getPersonalStore(db); s.pool(article); s.interpret('minor VinFast sales updates', article);
 await assert.rejects(confirm(db, [])); assert.equal(db.writes, 0);
});
test('confirmation merges rules and undo reverses only its contribution', async () => {
 const db = makeDb(); const a = await confirm(db); const b = await confirm(db);
 let state = (await getPersonalStore(db)).state;
 assert.equal(state.rules.length, 1); assert.equal(state.rules[0].feedbackCount, 2);
 await undoFeedback(db, a.id); state = (await getPersonalStore(db)).state;
 assert.equal(state.rules[0].feedbackCount, 1); assert.equal(state.rules[0].active, true);
 await undoFeedback(db, b.id); state = (await getPersonalStore(db)).state;
 assert.equal(state.rules[0].active, false); assert.equal(matchPersonal(state, article), null);
 assert.ok(state.decisions.every(d => !d.active));
});
test('failed durable write leaves no partial feedback and concurrent requests serialize', async () => {
 const db = makeDb(); const store = await getPersonalStore(db); const put = db.put; db.put = async () => { throw Error('disk'); };
 await assert.rejects(confirm(db)); assert.equal(store.state.events.length, 0);
 db.put = put; await Promise.all([confirm(db), confirm(db), confirm(db)]);
 assert.equal(store.state.rules[0].feedbackCount, 3);
});
test('Apply retry is idempotent, preferences survive a fresh database handle', async () => {
 const db = makeDb(); const event = await confirm(db, [reason], article, 'retry'); await confirm(db, [reason], article, 'retry');
 const stored = await db.get(PERSONAL_STATE_KEY); const reloaded = await getPersonalStore(makeDb({[PERSONAL_STATE_KEY]: stored}));
 assert.equal(reloaded.state.events.length, 1); assert.equal(reloaded.state.events[0].id, event.id);
});
test('routine entity and PR preferences preserve bankruptcy and security developments', () => {
 assert.equal(s.matches(reason.rule, {...article, link:'https://example.test/2'}), true);
 assert.equal(s.matches(reason.rule, {...article, title:'VinFast files for bankruptcy'}), false);
 const pr = s.pool(article).find(r => r.rule.dimension === 'quality').rule;
 assert.equal(s.matches(pr, {...article, title:'VinFast corporate PR campaign'}), true);
 assert.equal(s.matches(pr, {...article, title:'VinFast critical security incident'}), false);
 assert.equal(s.matches({...reason.rule, strength:'hide_all_entity'}, {...article,title:'VinFast files for bankruptcy'}), true);
});
test('story type means main event; scope is preserved', () => {
 const rule = {dimension:'story_type',eventType:'ranking_or_index',scope:'tech_vietnam',strength:'narrow'};
 assert.equal(s.matches(rule, {...article,title:'Innovation ranking rises'}),true);
 assert.equal(s.matches(rule, {...article,title:'Major enacted policy mentions innovation ranking'}),false);
 assert.equal(s.matches(rule, {...article,title:'Innovation ranking rises',smartCategory:'news_vietnam'}),false);
});
test('free text preserves person AND private-life angle', () => {
 const a = {...article,title:'Taylor Swift relationship news'};
 const r = s.interpret("don't care about Taylor Swift relationship news", a);
 assert.equal(r.rule.entity,'Taylor Swift'); assert.equal(r.rule.eventType,'private_life'); assert.notEqual(r.rule.strength,'hide_all_entity');
 assert.equal(s.matches(r.rule,{...a,title:'Taylor Swift major court investigation'}),false);
 assert.equal(s.interpret('unclear thing',a),null);
});
test('exact duplicates reused once, containment/fuzzy titles and changed evidence are kept', async () => {
 const db = makeDb(); const repeated = s.pool(article).find(r => r.rule.dimension === 'repetition');
 await confirm(db,[repeated]);
 assert.equal((await filterPersonalArticles(db,[article])).length,0);
 const rewrite = {...article,link:'https://second.test/story',feedUrl:'https://second.test/rss'};
 assert.equal((await filterPersonalArticles(db,[rewrite])).length,0);
 const writes = db.writes; await filterPersonalArticles(db,[rewrite]); assert.equal(db.writes,writes);
 assert.equal((await filterPersonalArticles(db,[{...article,title:article.title+' and commits $2 billion'}])).length,1);
 assert.equal((await filterPersonalArticles(db,[{...article,content:'Ministry denies the report.'}])).length,1);
});
test('terminal matching stops source/embedding path and worker state follows rules', async () => {
 const db = makeDb(); await confirm(db);
 const sources = [{url:article.feedUrl,category:'tech',region:'vietnam'}];
 assert.equal((await preparePersonalCandidates(db,[article],sources)).length,0);
 const worker = workerPrefilterValues((await prefilterWorkerState(db)).state);
 assert.equal(worker[PERSONAL_STATE_KEY].rules.length,1);
 assert.equal((await filterPublishedSnapshot(db,{articles:[article]})).articles.length,0);
 await disableRule(db,(await getPersonalStore(db)).state.rules[0].id);
 assert.equal((await preparePersonalCandidates(db,[article],sources)).length,1);
});
test('system and user logs are distinct and abandoned sessions never appear', async () => {
 const db = makeDb(); const system = {...article,title:'Innovation ranking moves up one place'};
 await preparePrefilterCandidates({db,articles:[system],sources:[{url:article.feedUrl,category:'tech',region:'vietnam'}],metrics:{}});
 await confirm(db);
 const result = await filterLog(db);
 assert.ok(result.rows.some(r=>r.origin==='system_editorial')); assert.ok(result.rows.some(r=>r.origin==='user_preference'));
 assert.equal(result.rows.filter(r=>r.origin==='user_preference').length,1);
});
test('optional semantic side output shares N requests and malformed tails never repair primary', async () => {
 const db = makeDb(); await bindPersonalState(db);
 const base = {type:'object',properties:{groups:{type:'array'}}};
 const spec = extendAiReview({articles:[article]},null,'Primary task',base);
 assert.ok(spec.schema.properties.personalSmartFeedback);
 let calls=0; const primary='{"groups":[]}';
 const before=await requestWithOptionalSideTask(async()=>{calls++;return primary;});
 const after=await requestWithOptionalSideTask(async()=>{calls++;return '{"groups":[],"personalSmartFeedback":[{"id":';});
 assert.equal(before,after); assert.equal(calls,2); // N=1 on each path
 const output=normalizeWithSideTask('{"groups":[],"personalSmartFeedback":[]}', x=> {assert.deepEqual(JSON.parse(x),{groups:[]});return x;});
 assert.deepEqual(primaryDecision(JSON.parse(output)),{groups:[]});
 await acceptAiSideTask(db,{articles:[article]},'{"groups":[]}', 'test');
 assert.equal((await getPersonalStore(db)).state.events.length,0);
});
test('actual picker controller keeps all unconfirmed paths ephemeral, including None x5', async () => {
 const context = vm.createContext({ console, crypto, SmartFeedbackSemantics:s, window:{innerWidth:1440,innerHeight:1000}, document:{querySelector:()=>null}, fetch:()=>{throw Error('unexpected network')} });
 vm.runInContext(await readFile('public/js/smart/feedback-picker.js','utf8')+'\nthis.factory=ReaderSmartFeedback;',context);
 const ui=context.factory.create(); Object.assign(ui,{selectedFilterType:'smart',selectedFilterValue:'tech_vietnam',usesTopStories:false,$nextTick:()=>{},articles:[article]});
 const calls=[]; ui.feedbackRequest=async(path)=>{calls.push(path);return {reasons:[]};};
 ui.openSmartFeedback(article);assert.equal(ui.feedbackCanApply,false);ui.cancelSmartFeedback();assert.equal(ui.feedbackHidden.length,0);
 ui.openSmartFeedback(article);ui.toggleFeedbackReason(ui.feedbackSession.displayed[0]);assert.equal(ui.feedbackCanApply,true);ui.cancelSmartFeedback();assert.equal(calls.length,0);
 ui.openSmartFeedback(article);
 for(let i=0;i<5;i++){const rejected=ui.feedbackSession.displayed.map(r=>r.id);await ui.differentFeedbackReasons();assert.ok(ui.feedbackSession.displayed.every(r=>!rejected.includes(r.id)));assert.equal(ui.feedbackCanApply,false);}
 ui.cancelSmartFeedback();assert.ok(calls.every(path=>path==='suggestions'));assert.equal(ui.feedbackHidden.length,0);
});
test('composed production UI includes shared button, picker and all monitor controls', async () => {
 const html=await createReaderAssetRenderer().html();
 assert.ok(html.includes('Show fewer stories like this')); assert.ok(html.includes('None of these — show different reasons'));
 assert.ok(!html.includes('reader:include smart/feedback-button'));
 for(const label of ['Source Stats','Fetch History','Error Log','Filtered','Pause Sync','Manual refresh only']) assert.ok(html.includes(label),label);
});
test('new cluster evidence survives an already-seen terminal even when the representative headline stays unchanged', async () => {
 const db = makeDb(); const other = {...article, link:'https://second.test/unchanged'};
 const cluster = {...article, relatedArticles:[other], clusterId:'event'};
 const repetition = s.pool(cluster).find(r => r.rule.dimension === 'repetition');
 await confirm(db,[repetition],cluster);
 assert.equal((await filterPersonalArticles(db,[cluster])).length,0);
 const update = {...cluster, relatedArticles:[other,{...article,link:'https://new.test/new',title:'VinFast commits $2 billion to a new factory'}]};
 assert.equal((await filterPersonalArticles(db,[update])).length,1);
});
test('AI matching is conservative: low confidence keeps, high confidence validates every constraint', async () => {
 const { acceptPersonalOutput } = await import('../src/smart/feedback/ai.js');
 const { identity } = await import('../src/smart/feedback/store.js');
 const db=makeDb();await confirm(db,[s.reason('No award stories',{dimension:'story_type',eventType:'award_or_contest',scope:'tech_vietnam',strength:'narrow'})]);
 const candidate={...article,title:'Company announces recognition',link:'https://example.test/recognition',smartPersonalSections:['tech_vietnam']};
 const rule=(await getPersonalStore(db)).state.rules[0];
 const response=confidence=>({personalSmartFeedback:[{id:identity(candidate).key,feedbackTraits:{eventType:'award_or_contest',materialityClass:'routine'},userPreferenceMatch:{matched:true,ruleId:rule.id,confidence,reason:'Award only'}}]});
 await acceptPersonalOutput(db,[candidate],response('low'),'test_ai');assert.equal(matchPersonal((await getPersonalStore(db)).state,candidate),null);
 await acceptPersonalOutput(db,[candidate],response('high'),'test_ai');assert.ok(matchPersonal((await getPersonalStore(db)).state,candidate));
});
test('None rejects semantic paraphrases and narrower recycling, while keeping genuinely different dimensions', () => {
 const pr={dimension:'quality',storyAngle:'corporate_pr',scope:'tech_vietnam',strength:'narrow'};
 const same={dimension:'story_type',eventType:'corporate_pr',scope:'tech_vietnam',strength:'narrow'};
 assert.equal(s.semanticKey(pr),s.semanticKey(same));
 assert.equal(s.isRejected({...pr,entity:'VinFast'},[s.semanticKey(pr)]),true);
 assert.equal(s.isRejected({dimension:'topic',topic:'AI',scope:'tech_vietnam',strength:'topic'},[s.semanticKey(pr)]),false);
});
