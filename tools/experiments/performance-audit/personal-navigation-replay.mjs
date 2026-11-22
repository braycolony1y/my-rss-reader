import {writeFile} from 'node:fs/promises';
import {confirmFeedback,undoFeedback} from '../../../src/smart/feedback/store.js';
import {semantics} from '../../../src/smart/feedback/semantics.js';
import {filterPersonalView} from '../../../src/smart/feedback/pipeline.js';
import {createPersonalViewCache} from '../../../src/articles/personal-view-cache.js';
const db={async get(){return null;},async put(){}},cached=createPersonalViewCache();
const seed={title:'VinFast monthly deliveries increase',link:'https://example.test/seed',content:'Monthly vehicle delivery numbers.',topStory:{feed:'tech_vietnam'}};
const event=await confirmFeedback(db,{article:seed,surface:'smart_top',selectedReasons:[semantics.pool(seed).find(r=>r.rule.dimension==='entity')]});
const articles=Array.from({length:861},(_,i)=>({title:`Software compiler release ${i}`,link:`https://example.test/${i}`,content:'Representative software news. '.repeat(40),topStory:{feed:'tech_vietnam'}}));
const rows=[];
for(const variant of ['before','after','after','before']) {
 const filter=variant==='before'?filterPersonalView:cached;
 for(let i=0;i<16;i++){
  const start=performance.now();const kept=await filter(db,articles,'tech_vietnam','pre_classic_ranking');
  if(kept.length!==articles.length)throw Error('Changed filtering');
  rows.push({variant,ms:performance.now()-start});
 }
}
const excluded=[{...seed,link:'https://example.test/second'}];
if((await cached(db,excluded,'tech_vietnam','view')).length)throw Error('Dismissal not applied');
await undoFeedback(db,event.id);
if((await cached(db,excluded,'tech_vietnam','view')).length!==1)throw Error('Undo invalidation failed');
await writeFile(process.argv[2],JSON.stringify(rows));console.log('Matched filtering and Undo verified');
