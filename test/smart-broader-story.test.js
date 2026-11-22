import test from 'node:test';
import assert from 'node:assert/strict';
import { attachBroaderStoryMetadata, getArticleId } from '../smart-news.js';

const article = (n, title, date) => ({
  link: `https://example.com/${n}`,
  title,
  pubDate: date,
  feedTitle: `Source ${n}`,
  smartCategory: 'news_world',
  feedCategory: 'news_world',
  language: 'en',
  sourceWeight: 1,
  content: `${title}. Factual source text for component ${n}.`
});

test('broader-story metadata preserves separate events while exposing a full connected timeline', () => {
  const a = article('event-a', 'Company announces acquisition', '2026-09-10T10:00:00Z');
  const b = article('event-b', 'Regulator opens review of acquisition', '2026-09-11T10:00:00Z');
  const c = article('event-c', 'Deal receives final approval', '2026-09-20T10:00:00Z');
  const clusters = [a,b,c].map((item,index) => ({...item,clusterId:`cluster-${index}`,isCluster:true,relatedArticles:[],sourceCount:1}));
  const linked = attachBroaderStoryMetadata(clusters, [
    {type:'related_development',confidence:.97,leftArticleIds:[getArticleId(a)],rightArticleIds:[getArticleId(b)]},
    {type:'related_development',confidence:.96,leftArticleIds:[getArticleId(b)],rightArticleIds:[getArticleId(c)]}
  ]);
  assert.equal(linked[0].clusterCount, undefined);
  assert.equal(linked[0].broaderStory.events.length, 3);
  assert.deepEqual(linked[0].broaderStory.events.map(event=>event.title), [
    'Company announces acquisition',
    'Regulator opens review of acquisition',
    'Deal receives final approval'
  ]);
  assert.equal(linked[0].clusterId, 'cluster-0');
  assert.equal(linked[1].clusterId, 'cluster-1');
});
