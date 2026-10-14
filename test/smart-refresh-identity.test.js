import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/js/smart/refresh.js',import.meta.url),'utf8');
function fixture() {
    let callback, resolve, scheduled=0;
    const gate=new Promise(r=>resolve=r);
    const module=vm.runInNewContext(source+';ReaderSmartRefresh',{URLSearchParams,document:{hidden:false},
        setTimeout:fn=>{callback=fn;scheduled++;return scheduled;},clearTimeout(){},fetch:async()=>({ok:true,json:()=>gate})});
    const article={clusterId:'one',link:'old',title:'Current',topStory:{material_version:1},briefing:{analysisStatus:'queued'}};
    const app={usesTopStories:true,selectedFilterValue:'news_vietnam',smartRegion:'vietnam',smartViewToken:'view',
        articleRequestGeneration:1,currentPage:1,articles:[article]};
    return {module,app,article,resolve,run:()=>callback(),scheduled:()=>scheduled};
}
test('Smart publication reuses matching objects while accepting authoritative order, removal and insertion',()=>{
    const {module,article}=fixture();const removed={clusterId:'gone'},second={clusterId:'two'};
    const incoming=[{clusterId:'two',title:'Second'},{clusterId:'one',link:'canonical',title:'Fresh',image:'new'}, {clusterId:'new'}];
    const result=module.reconcile([article,removed,second],incoming);
    assert.equal(result[0],second);assert.equal(result[1],article);assert.equal(result[2],incoming[2]);
    assert.equal(article.title,'Fresh');assert.equal(article.link,'canonical');assert.equal(article.image,'new');
    assert.ok(!result.includes(removed));
});
test('ambiguous and missing identities never reuse a card for another story',()=>{
    const {module}=fixture();
    for(const [current,incoming] of [
        [[{clusterId:'x'},{clusterId:'x'}],[{clusterId:'x'}]],
        [[{clusterId:'x'}],[{clusterId:'x'},{clusterId:'x'}]],
        [[{title:'A'}],[{title:'B'}]],
        [[{clusterId:'old',link:'same'}],[{clusterId:'new',link:'same'}]]
    ])assert.ok(module.reconcile(current,incoming).every(a=>!current.includes(a)));
});
test('older poll cannot replace a briefing pushed during its JSON download',async()=>{
    const f=fixture();f.module.schedule(f.app,0,0);const pending=f.run();await Promise.resolve();
    const pushed={analysisStatus:'evaluated',sections:[{text:'Completed'}]};f.article.briefing=pushed;
    f.resolve({articles:[{clusterId:'one',title:'Fresh metadata',topStory:{material_version:1},briefing:{analysisStatus:'queued'}}]});
    await pending;assert.equal(f.article.briefing,pushed);assert.equal(f.article.title,'Fresh metadata');assert.equal(f.scheduled(),2);
});
test('new material may replace an evaluated briefing and still retains the card object',async()=>{
    const f=fixture();f.article.briefing={analysisStatus:'evaluated'};f.module.schedule(f.app,0,0);const pending=f.run();
    f.resolve({articles:[{clusterId:'one',topStory:{material_version:2},briefing:{analysisStatus:'queued'}}]});
    await pending;assert.equal(f.article.briefing.analysisStatus,'queued');assert.equal(f.app.articles[0],f.article);
});
for(const change of ['generation','destination','filter','mode'])test(`obsolete ${change} poll cannot apply or rearm over current view`,async()=>{
    const f=fixture();f.module.schedule(f.app,0,0);const pending=f.run();
    if(change==='generation')f.app.articleRequestGeneration++;
    if(change==='destination')f.app.selectedFilterValue='tech_global';
    if(change==='filter')f.app.hideRead=true;
    if(change==='mode')f.app.usesTopStories=false;
    f.resolve({articles:[{clusterId:'one',title:'Obsolete'}],rankingPending:true});await pending;
    assert.equal(f.article.title,'Current');assert.equal(f.app.rankingPending,undefined);assert.equal(f.scheduled(),1);
});

test('full Top revalidation also preserves completed briefing for unchanged material',()=>{
 const {module,article}=fixture();const completed={analysisStatus:'evaluated'};article.briefing=completed;
 module.reconcile([article],[{clusterId:'one',topStory:{material_version:1},briefing:{analysisStatus:'queued'}}]);
 assert.equal(article.briefing,completed);
 module.reconcile([article],[{clusterId:'one',topStory:{material_version:2},briefing:{analysisStatus:'queued'}}]);
 assert.equal(article.briefing.analysisStatus,'queued');
});

test('authoritative publication removes omitted metadata without resurrecting stale thumbnails',()=>{
 const {module,article}=fixture();article.image='old-photo';article.imageCandidates=['old-fallback'];article.topStory={material_version:1};
 const result=module.reconcile([article],[{clusterId:'one',title:'Updated without photo'}]);
 assert.equal(result[0],article);assert.equal(article.image,undefined);assert.equal(article.imageCandidates,undefined);assert.equal(article.topStory,undefined);
});
