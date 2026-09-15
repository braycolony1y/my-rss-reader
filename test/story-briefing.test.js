import test from 'node:test';
import assert from 'node:assert/strict';
import { rankStory, retainStoryIds, storyRevision } from '../src/articles/story-ranking.js';
import { briefingSources, validateBriefing, createStoryBriefings, REQUIRED_ANALYSIS_REVIEW } from '../src/articles/story-briefing.js';
import { createArticlePresentation } from '../src/articles/presentation.js';
const fixtureEditorialAssessment = (id, category) => {
    const destination =
        category === 'finance_global'
            ? 'finance_world'
            : category === 'news_vietnam'
                ? 'news_vietnam'
                : category === 'news_world'
                    ? 'news_world'
                    : category === 'tech_vietnam'
                        ? 'tech_vietnam'
                        : 'tech_world';

    return {
        policyVersion: 'ai-editorial-v1',
        revision: `fixture-${id}-${category}`,
        eligibleDestinations:
            category === 'tech'
                ? ['tech_vietnam', 'tech_world']
                : [destination],
        destination,
        relevance: .95,
        impact: .8,
        novelty: .8,
        confidence: .9,
        exclude: false,
        reason: 'Fixture editorial assessment'
    };
};

const article = (id, category = 'tech', extra = {}) => {
    const smartCategory =
        extra.smartCategory || category;

    return {
        link: `https://${id}.com/story`,
        feedUrl: `https://${id}.com/rss`,
        title:
            extra.title ||
            'Regulator approves chip export restrictions',

        content:
            extra.content ||
            'The regulator approved chip export restrictions on Friday. The new rules affect three manufacturers.',
        pubDate: new Date().toISOString(),
        smartCategory,
        image: 'https://images.com/photo.jpg',
        feedTitle: id,
        sourceWeight: 1.2,
        editorialAssessment:
            extra.editorialAssessment ??
            fixtureEditorialAssessment(id, smartCategory),
        ...extra
    };
};
const readState = (state, key) => key === 'smartSources' ? (state.smartSources || (state.smartClusters || []).flatMap(c => [c, ...(c.relatedArticles || [])]).map(a => ({url:a.feedUrl,category:a.smartCategory,region:a.region}))) : state[key];
const cluster = { ...article('one'), clusterId: 'event-one', isCluster: true, verification: { method: 'ai_fallback' }, relatedArticles: [article('two')] };

test('publisher feeds and reprints cannot inflate score; material updates change the revision', () => {
    const original = article('one');
    const copies = Array.from({length: 30}, (_,i) => ({ ...original, link: `https://one.com/${i}`, feedTitle: `Section ${i}` }));
    assert.equal(rankStory(copies).independentSources, 1);
    assert.equal(rankStory(copies).score, rankStory([original]).score);
    assert.notEqual(storyRevision(cluster), storyRevision({ ...cluster, content: 'A new development has been reported.' }));
});

test('cluster identity survives a new member and is not duplicated on split', () => {
    const updated = { ...cluster, clusterId: 'new-id', relatedArticles: [...cluster.relatedArticles, article('three')] };
    assert.equal(retainStoryIds([updated], [cluster])[0].clusterId, cluster.clusterId);
    const split = retainStoryIds([{ ...article('one'), clusterId:'a' }, { ...article('two'), clusterId:'b' }], [cluster]);
    assert.equal(new Set(split.map(c => c.clusterId)).size, 2);
});

test('briefing rejects fabricated sources or quotes and preserves original links', () => {
    const sources = briefingSources(cluster);
    const value = { headline: cluster.title, sections: [{ label:'What happened', text:'The regulator approved restrictions.', evidence:[{sourceId:1, quote:'The regulator approved chip export restrictions on Friday.'}] }] };
    const result = validateBriefing(value, sources);
    assert.equal(result.sections[0].citations[0].link, cluster.link);
    assert.throws(() => validateBriefing({ ...value, sections: [{ ...value.sections[0], evidence:[{sourceId:999, quote:'A fabricated source excerpt'}] }] }, sources));
    assert.throws(() => validateBriefing({ ...value, sections: [{ ...value.sections[0], evidence:[{sourceId:1, quote:'The bank cut rates by 5 percent.'}] }] }, sources));
});

test('all Top stories are paginated clusters with briefings, respecting tabs and hidden sources', async () => {
    const state = { smartClusters: [cluster, { ...article('other', 'tech', {title:'OpenWrt publishes router security patch'}), clusterId:'other', isCluster:true }, { ...article('finance', 'finance_global', {title:'Central bank cuts interest rates'}), clusterId:'finance', isCluster:true }], smartRawArticles: [article('one'), article('two')], smartClusterVersion:'v1', userPreferences:{topStoryCounts:{tech:1, finance_global:0}}, hiddenStates:[article('two').link] };
    const db = {get:async key => readState(state,key), put:async (key,value) => state[key]=JSON.parse(value)};
    const presentation = createArticlePresentation({ env:{RSS_DATA:db}, generateBriefing:async () => { throw new Error('offline fixture'); } });
    const request = async query => { let response; await presentation.serveSmartData({query:{filterValue:'tech', limit:'1', ...query}}, {setHeader(){}, json:data=>response=data}); return response; };
    const first = await request();
    assert.equal(first.topStories.length, 0);
    assert.equal(first.articles.length, 1);
    assert.ok(first.articles.every(a => a.smartCategory === 'tech' && a.briefing));
    assert.ok(first.articles.every(a => !(a.relatedArticles || []).some(r => r.link === article('two').link)));
    const next = await request({page:'2',smartView:first.smartViewToken});
    assert.equal(next.articles.length, 1);
    assert.notEqual(next.articles[0].link, first.articles[0].link);
    assert.ok(next.articles[0].briefing);
    const finance = await request({filterValue:'finance_global'});
    assert.equal(finance.topStories.length,0);
    assert.equal(finance.articles.length,1);
    assert.equal((await request({filterValue:''})).topStories.length,0);
});

test('briefing queue deduplicates requests and invalidates prose after updated evidence', async () => {
    const store={};let calls=0;
    const service=createStoryBriefings({db:{get:async k=>store[k],put:async(k,v)=>store[k]=JSON.parse(v)},generate:async()=>{calls++;return JSON.stringify({analysisReview:REQUIRED_ANALYSIS_REVIEW.map(label=>({label,useful:false,reason:'No distinct supported insight in this brief fixture.'})),headline:cluster.title,sections:[{label:'What happened',text:'The rules affect three manufacturers.',evidence:[{sourceId:1,quote:'The new rules affect three manufacturers.'}]}]});}});
    await Promise.all([service.get(cluster,'tech'), service.get(cluster,'tech')]);
    await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(calls,1);
    assert.equal((await service.get(cluster,'tech')).status,'ready');
    assert.equal((await service.get({...cluster,content:'Updated evidence differs.'},'tech')).status,'stale');
});

test('strict early publication clusters syndicated headlines without losing unrelated candidates', async () => {
    const { buildEarlySmartClusters } = await import('../smart-news.js');
    const unrelated=article('different','tech',{title:'Company launches a new purple keyboard for gamers'});
    const candidates=[article('one'),article('two'),unrelated];
    const groups=buildEarlySmartClusters(candidates);
    assert.equal(groups.length,2);
    assert.equal(groups.find(g=>g.relatedArticles.length).relatedArticles.length,1);
    assert.equal(new Set(groups.flatMap(g=>[g.link,...g.relatedArticles.map(a=>a.link)])).size,3);
});

test('page snapshot remains stable when an AI importance score arrives', async () => {
    const one={...article('one'),isCluster:true,clusterId:'one'};
    const two={...article('two','tech',{title:'OpenWrt publishes a security patch'}),isCluster:true,clusterId:'two'};
    const three={...article('three','tech',{title:'Nvidia launches a new GPU architecture'}),isCluster:true,clusterId:'three'};
    const state={smartClusters:[one,two,three],smartClusterVersion:'v1',userPreferences:{topStoryCounts:{tech:1}}};
    const db={get:async k=>readState(state,k),put:async(k,v)=>state[k]=JSON.parse(v)};
    const presentation=createArticlePresentation({env:{RSS_DATA:db},generateBriefing:async()=>{throw new Error('offline fixture')}});
    const request=async query=>{let result;await presentation.serveSmartData({query:{filterValue:'tech',limit:1,...query}},{setHeader(){},json:r=>result=r});return result;};
    const first=await request();
    state.smartClusters=[{...three,pubDate:new Date(Date.now()+10000).toISOString()},two,one];state.smartClusterVersion='v2';
    const second=await request({smartView:first.smartViewToken,page:2});
    assert.equal(second.smartViewToken,first.smartViewToken);
    assert.notEqual(second.articles[0].link,first.articles[0].link);
    const switched=await request({smartView:first.smartViewToken,smartMode:'classic',page:1});
    assert.notEqual(switched.smartViewToken,first.smartViewToken);
    assert.equal(switched.smartTabMode,'classic');
    assert.equal(switched.articles[0].topStory,undefined);
});

test('an unread development stays visible when its representative has been read', async () => {
    const state={smartClusters:[cluster],smartClusterVersion:'v1',readStates:[cluster.link],userPreferences:{topStoryCounts:{tech:1}}};
    const db={get:async k=>readState(state,k),put:async()=>{}};
    const presentation=createArticlePresentation({env:{RSS_DATA:db},generateBriefing:async()=>{throw new Error('offline fixture')}});
    let result;await presentation.serveSmartData({query:{filterValue:'tech',hideRead:'true'}},{setHeader(){},json:r=>result=r});
    assert.equal(result.articles.length,1);
    state.readStates.push(cluster.relatedArticles[0].link);
    await presentation.serveSmartData({query:{filterValue:'tech',hideRead:'true'}},{setHeader(){},json:r=>result=r});
    assert.equal(result.articles.length,0);
});

test('Top stories is the default and Classic is independent for each tab', async () => {
    const state={smartClusters:[cluster,{...article('finance','finance_global',{title:'Central bank announces interest rate decision'}),isCluster:true,clusterId:'finance'}],smartClusterVersion:'v1',userPreferences:{topStoryCounts:{tech:1},smartTabModes:{finance_global:'classic'}}};
    const db={get:async k=>readState(state,k),put:async()=>{}};
    const presentation=createArticlePresentation({env:{RSS_DATA:db},generateBriefing:async()=>{throw new Error('offline fixture')}});
    const request=async tab=>{let result;await presentation.serveSmartData({query:{filterValue:tab}},{setHeader(){},json:r=>result=r});return result;};
    const tech=await request('tech');assert.equal(tech.smartTabMode,'top');assert.equal(tech.topStories.length,0);assert.equal(tech.articles.length,1);assert.ok(tech.articles[0].briefing);
    const finance=await request('finance_global');assert.equal(finance.smartTabMode,'classic');assert.equal(finance.topStories.length,0);assert.equal(finance.articles.length,1);
    state.userPreferences.smartTabModes.tech='classic';
    const classic=await request('tech');assert.equal(classic.topStories.length,0);assert.equal(classic.articles.length,1);assert.equal(classic.articles[0].relatedArticles.length,1);
    state.userPreferences.smartTabModes.tech='top';assert.equal((await request('tech')).articles.length,1);
});


test('Classic reads cached briefings without starting AI work', async () => {
    let calls=0;
    const service=createStoryBriefings({db:{get:async()=>null,put:async()=>{}},generate:async()=>{calls++;throw new Error('must not run')}});
    await service.get(cluster,'tech',{generate:false});
    await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(calls,0);
});
