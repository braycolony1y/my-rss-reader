import test from 'node:test';
import assert from 'node:assert/strict';
import { detectRoundup, roundupItems } from '../src/articles/story-roundups.js';
import { createTopStoriesIndex } from '../src/articles/top-stories.js';
import { briefingSources, createStoryBriefings } from '../src/articles/story-briefing.js';
const now = Date.parse('2026-09-13T12:00:00Z');
const article = (id, title, content = title, extra = {}) => ({ link:`https://${id}.example/article`, feedUrl:`https://${id}.example/rss`, feedTitle:id, title, content, pubDate:new Date(now).toISOString(), language:'en', smartCategory:'news_world', ...extra });
const storm = article('storm', 'Authorities order evacuation as cyclone Alba reaches coast');
const bank = article('bank', 'Central bank announces interest rate cut on Friday');
const router = article('router', 'OpenWrt confirms critical vulnerability in router firmware');
const container = article('digest', 'Morning news roundup', `<ul><li>${storm.title}.</li><li>${bank.title}.</li><li>${router.title}.</li></ul>`);
const sourcesFor = articles => articles.map(a=>({url:a.feedUrl, category:a.smartCategory}));
function harness(initial = {}) {
    const state = structuredClone(initial);
    const db = {get:async key=>state[key], put:async(key,value)=>{state[key]=JSON.parse(value)}};
    return {state,db,index:createTopStoriesIndex({db})};
}
test('detects the reported Vietnamese morning bulletin from RSS text', () => {
    const a = article('baotintuc', 'Tin nóng thế giới sáng 13/9/2026', 'Bản tin có những nội dung sau đây: - Nga bác một đề xuất về Ukraine; - Oman công bố thỏa thuận về hàng hải; - Mỹ chặn tàu thương mại; - Bỉ phát hiện UAV tại sân bay. Các bài viết khác.', {language:'vi'});
    const result=detectRoundup(a);
    assert.equal(result.isRoundup,true);
    assert.equal(result.items.length,4);
    assert.ok(!result.items.at(-1).text.includes('Các bài viết khác'));
});
test('detects multi-event newsletters, podcasts, lists and mixed live digests', () => {
    for (const title of ['Daily news digest', 'Evening news roundup', 'Top stories today', 'Newsletter', 'Podcast: today in the news', 'Multi-topic live digest', 'Latest developments']) {
        const body=`<h2>Alpha announces trade sanctions</h2><p>Details on Alpha.</p><h2>Beta confirms volcanic eruption</h2><p>Details on Beta.</p><h2>Gamma launches lunar spacecraft</h2><p>Details on Gamma.</p>`;
        assert.equal(detectRoundup(article('test',title,body)).isRoundup,true,title);
    }
});
test('single-event live coverage, explainers and newsletters stay ordinary stories', () => {
    for (const title of ['Ukraine ceasefire live updates', 'Newsletter: OpenWrt fixes a critical vulnerability', 'Podcast: an interview about the central bank decision', 'A roundup of evidence in the trial']) {
        assert.equal(detectRoundup(article('single',title,'<h2>What happened</h2><p>The same event is described.</p><h2>Why it matters</h2><p>Context for that event.</p>')).isRoundup,false,title);
    }
});
test('containers cannot aggregate scores, qualify for Top, or create bullet stories', async () => {
    const {index}=harness();
    const result=await index.rank([container],sourcesFor([container]),now);
    assert.equal(result.length,1);
    assert.equal(result[0].title,container.title);
    assert.equal(result[0].topStory.isTop,false);
    assert.equal(result[0].ranking.score,0);
    assert.ok(Object.entries(result[0].ranking.signals).filter(([,v])=>typeof v==='number').every(([,v])=>v===0));
    assert.deepEqual(result[0].topStory.timeline,[]);
});
test('attaches only matching event excerpts without ranking or freshness inflation', async () => {
    const {index}=harness(); const sources=sourcesFor([storm,bank,router,container]);
    const first=await index.rank([storm,bank,router],sources,now);
    const result=await index.rank([storm,bank,router,container],sources,now);
    assert.equal(result.length,4);
    for (const story of result.filter(s=>!s.topStory.isRoundup)) {
        const original=first.find(s=>s.link===story.link);
        assert.equal(story.ranking.score,original.ranking.score);
        assert.equal(story.topStory.material_version,original.topStory.material_version);
        assert.equal(story.topStory.latest_material_update,original.topStory.latest_material_update);
        assert.equal(story.relatedArticles.filter(a=>a.roundupSupport).length,1);
        const sources=briefingSources(story);
        assert.equal(sources.length,2);
        assert.equal(sources[1].text,story.title+'.');
        for (const other of [storm,bank,router].filter(a=>a.link!==story.link)) assert.ok(!JSON.stringify(sources).includes(other.title));
    }
});
test('a shared container cannot merge unrelated upstream clusters', async () => {
    const {index}=harness();
    const result=await index.rank([{...storm,clusterId:'storm',relatedArticles:[container]}, {...bank,clusterId:'bank',relatedArticles:[container]}],sourcesFor([storm,bank,container]),now);
    assert.equal(result.filter(s=>!s.topStory.isRoundup).length,2);
    assert.equal(new Set(result.map(s=>s.clusterId)).size,3);
    const mixed=await index.rank([{...container,clusterId:'mixed',relatedArticles:[storm,bank]}],sourcesFor([storm,bank,container]),now);
    assert.equal(mixed.filter(s=>!s.topStory.isRoundup).length,2);
});
test('roundup support cannot cross unconfigured source destinations', async () => {
    const {index}=harness();
    const result=await index.rank([router,container],[{url:router.feedUrl,category:'tech',region:'foreign'},{url:container.feedUrl,category:'news_world'}],now);
    assert.equal(result.find(s=>s.link===router.link).relatedArticles.length,0);
});
test('ambiguous roundup bullets are not attached and short bullets create no events', async () => {
    const {index}=harness();
    const one=article('one','Central bank announces interest rate cut on Friday in Alpha');
    const two=article('two','Central bank announces interest rate cut on Friday in Beta');
    const digest=article('daily','Daily news digest',`<ul><li>Central bank announces interest rate cut on Friday</li><li>Markets rise</li></ul>`);
    const result=await index.rank([one,two,digest],sourcesFor([one,two,digest]),now);
    assert.equal(result.length,3);
    assert.ok(result.every(s=>!s.relatedArticles.some(a=>a.roundupSupport)));
});
test('container briefing bypasses old generated caches and never calls AI',async()=>{
    let calls=0;const {db,state}=harness({storyBriefings:{'latest:news_world:digest':{sections:[{label:'What happened',text:'Unsafe multi-event summary'}]}}});
    const service=createStoryBriefings({db,generate:async()=>{calls++;return '{}'}});
    const result=await service.get({...container,clusterId:'digest'},'news_world');
    assert.equal(result.status,'source-only');assert.deepEqual(result.sections,[]);assert.equal(calls,0);
    assert.equal(briefingSources(container).length,0);
});
test('detaching a previously ranked roundup invalidates contaminated cached prose',async()=>{
    const {state,db,index}=harness();
    const sources=sourcesFor([storm,container]);
    const [first]=await index.rank([storm],sources,now);
    const old=state.topStoriesState[first.clusterId];
    old.links.push(container.link);delete old.roundupPolicyVersion;
    state.storyBriefings={ [`latest:news_world:${first.clusterId}`]:{sections:[{label:'What happened',text:'Old mixed-event prose'}]} };
    const restarted=createTopStoriesIndex({db});
    const result=await restarted.rank([{...storm,relatedArticles:[container]}],sources,now);
    const clean=result.find(s=>s.link===storm.link);
    assert.equal(clean.topStory.briefing_scope_version,2);
    const service=createStoryBriefings({db,generate:async()=>{throw Error('offline')}});
    const briefing=await service.get(clean,'news_world',{generate:false});
    assert.deepEqual(briefing.sections,[]);
});
