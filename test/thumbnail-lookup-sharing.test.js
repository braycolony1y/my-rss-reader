import test from 'node:test';
import assert from 'node:assert/strict';
import {createArticleImages} from '../src/articles/images.js';
import {registerMediaRoutes} from '../src/routes/media-routes.js';
const cover='https://images.example.com/cover.jpg',article='https://example.com/story';

test('real thumbnail and focus handlers share extraction when the RSS fallback is empty',async()=>{
 let calls=0;
 const images=createArticleImages({
  getLastKnownCachedArticleImage:async()=>null,
  getArticleFetchPolicy:async()=>({strategyOrder:['direct']}),
  fetchParsedArticleByStrategy:async()=>{calls++;await new Promise(r=>setTimeout(r,20));return {content:'<p>Fixture article</p>',image:cover};},
  cacheArticleResult:async()=>{}
 });
 const handlers=new Map();
 registerMediaRoutes({app:{get:(url,...steps)=>handlers.set(url,steps.at(-1))},getBestImage:images.getBestImage,
  getLastKnownCachedArticleImage:async()=>null,imageFocalCache:{get:async()=>({x:.5,y:.5})}});
 const response=()=>({setHeader(){},redirect(){},json(){},status(){return this;},send(){}});
 await Promise.all([
  handlers.get('/api/og-image')({query:{url:article,rss:''}},response()),
  handlers.get('/api/image-focus')({query:{src:'/api/og-image?'+new URLSearchParams({url:article,rss:''})}},response())
 ]);
 assert.equal(calls,1,'one thumbnail must not run two full article extractions');
});

test('different valid fallbacks remain distinct and failed lookups can retry',async()=>{
 let calls=0;
 const images=createArticleImages({getLastKnownCachedArticleImage:async()=>null,getArticleFetchPolicy:async()=>({strategyOrder:['direct']}),
  fetchParsedArticleByStrategy:async()=>{calls++;await new Promise(r=>setTimeout(r,10));throw Error('offline');},cacheArticleResult:async()=>{}});
 const other='https://images.example.com/other.jpg';
 assert.deepEqual(await Promise.all([images.getBestImage(article,null,cover),images.getBestImage(article,null,other)]),[cover,other]);
 assert.deepEqual(await Promise.all([images.getBestImage(article,null,''),images.getBestImage(article,null,null)]),[null,null]);
 assert.equal(calls,1);
 assert.equal(await images.getBestImage(article),null);assert.equal(calls,2,'failed lookup must not become a permanent negative cache');
});
