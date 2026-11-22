import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createParsedCache } from '../src/database/parsed-cache.js';
import { articleIdentity } from '../src/smart/prefilter/identity.js';
import { identity } from '../src/smart/feedback/identity.js';
import { filterPublishedSnapshot } from '../src/smart/prefilter/publication.js';
import { confirmFeedback, undoFeedback } from '../src/smart/feedback/store.js';
import { semantics } from '../src/smart/feedback/semantics.js';
import { getPrefilterStore } from '../src/smart/prefilter/state.js';
import { FILTER_VERSION } from '../src/smart/prefilter/policy.js';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function originalIdentity(article) {
 const value = articleIdentity(article);
 const clusterSignature = article.relatedArticles?.length ? digest(article.relatedArticles.map(member => articleIdentity(member).key).sort()) : null;
 return { key: clusterSignature ? digest([value.key, clusterSignature]) : value.key, clusterSignature, revision:value.revision, title:value.safeTitle, keys:value.keys.map(([,key])=>key), materialVersion:article.topStory?.material_version || null };
}
const article = () => ({title:'VinFast monthly deliveries increase',link:'https://example.test/vinfast/1',content:'Monthly vehicle delivery numbers.',smartCategory:'tech_vietnam',feedUrl:'https://example.test/rss',topStory:{feed:'tech_vietnam'}});
const dbFixture = () => { const data = new Map(); return { async get(k){return data.get(k);}, async put(k,v){data.set(k,typeof v==='string'?JSON.parse(v):v);} }; };

test('evicted shared parses reuse an externally owned graph without increasing the strong byte budget', () => {
 let now = 1;
 const cache = createParsedCache({maxBytes:12,maxEntries:4,ttlMs:10,now:()=>now});
 const first = {articles:[{title:'old'}]}, second = {articles:[]};
 cache.set('a','aaaa',first); cache.set('b','bbbb',second);
 assert.equal(cache.get('a','aaaa').parsed,first);
 assert.ok(cache.state().estimatedSourceBytes<=12);
 assert.equal(cache.state().recovered,1);
 cache.invalidate('a','new'); assert.equal(cache.get('a','aaaa'),undefined);
 cache.set('a','aaaa',first); now+=11; assert.equal(cache.get('a','aaaa'),undefined);
 cache.set('a','aaaa',first); cache.clear(); assert.equal(cache.get('a','aaaa'),undefined);
});
test('personal identity reuse is equivalent and invalidates every evidence/identity field and nested member change', () => {
 const value=article(); value.relatedArticles=[article()];
 for(const field of ['link','title','content','description','summary','feedUrl','guid','articleKey','contentHash']) {
   assert.deepEqual(identity(value),originalIdentity(value));
   assert.equal(JSON.stringify(identity(value)),JSON.stringify(originalIdentity(value)));
   value[field]=(value[field]||'')+'changed';
   assert.deepEqual(identity(value),originalIdentity(value));
   value.relatedArticles[0][field]=(value.relatedArticles[0][field]||'')+'changed';
   assert.deepEqual(identity(value),originalIdentity(value));
 }
 value.topStory.material_version=2; assert.deepEqual(identity(value),originalIdentity(value));
 value.relatedArticles.push(article()); assert.deepEqual(identity(value),originalIdentity(value));
 value.relatedArticles.reverse(); assert.deepEqual(identity(value),originalIdentity(value));
});
test('published reuse immediately honors personal Apply, Undo, and system decision revisions',async()=>{
 const db=dbFixture(), value=article(), snapshot={articles:[value]};
 assert.equal(await filterPublishedSnapshot(db,snapshot),snapshot);
 const event=await confirmFeedback(db,{article:value,surface:'smart_top',selectedReasons:[semantics.pool(value).find(r=>r.rule.dimension==='entity')]});
 assert.equal((await filterPublishedSnapshot(db,snapshot)).articles.length,0);
 assert.equal((await filterPublishedSnapshot(db,snapshot)).articles.length,0);
 await undoFeedback(db,event.id);
 assert.equal((await filterPublishedSnapshot(db,snapshot)).articles.length,1);
 const system=await getPrefilterStore(db);
 value.smartTopPrefilter={tech_vietnam:{filterVersion:FILTER_VERSION,section:'tech_vietnam',status:'exclude',final:true,reasonCode:'TEST'}};
 system.revision++;
 assert.equal((await filterPublishedSnapshot(db,snapshot)).articles.length,0);
 value.smartTopPrefilter={}; system.revision++;
 assert.equal((await filterPublishedSnapshot(db,snapshot)).articles.length,1);
 const replacement={articles:[article()]}; assert.equal(await filterPublishedSnapshot(db,replacement),replacement);
});
