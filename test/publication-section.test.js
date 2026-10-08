import test from 'node:test';
import assert from 'node:assert/strict';
import {publicationSection, publicationDestination} from '../src/articles/publication-section.js';
import {filterPublishedView} from '../src/smart/prefilter/published-view.js';
import {confirmFeedback, undoFeedback} from '../src/smart/feedback/store.js';
import {semantics} from '../src/smart/feedback/semantics.js';

test('section views share immutable cards, preserve ordering and renew with publication generation', () => {
    const snapshot = {signature:'one', articles:['tech_world','news_vietnam','tech_global'].map((feed,i)=>({id:i,topStory:{feed}}))};
    const view = publicationSection(snapshot,'tech_global');
    assert.deepEqual(view.articles,[snapshot.articles[0],snapshot.articles[2]]);
    assert.equal(publicationSection(snapshot,'tech_global'),view);
    assert.equal(publicationSection(snapshot),snapshot);
    assert.notEqual(publicationSection({...snapshot},'tech_global'),view);
    assert.equal(publicationDestination('tech','vietnam'),'tech_vietnam');
    assert.equal(publicationDestination('finance_foreign'),'finance_global');
});

test('cached destination views recheck confirmed preferences and Undo', async () => {
    const db = {async get(){return null;},async put(){}};
    const article = {title:'VinFast monthly deliveries increase',link:'https://example.test/car',content:'Monthly vehicle delivery numbers.',topStory:{feed:'tech_vietnam'}};
    const view = publicationSection({articles:[article]},'tech_vietnam');
    assert.equal(await filterPublishedView(db,view),view);
    const event = await confirmFeedback(db,{article,surface:'smart_top',selectedReasons:[semantics.pool(article).find(reason=>reason.rule.dimension==='entity')]});
    assert.equal((await filterPublishedView(db,view)).articles.length,0);
    await undoFeedback(db,event.id);
    assert.equal(await filterPublishedView(db,view),view);
});
