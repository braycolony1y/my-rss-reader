import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createArticleCache } from '../src/articles/cache.js';
import { createArticlePresentation } from '../src/articles/presentation.js';
import { vozThreadCreationTime } from '../src/articles/voz-creation-time.js';
import { fnv1a } from '../src/utils/article-utils.js';

const url = 'https://voz.vn/t/example.123';
const created = '2026-10-18T10:49:36.000Z';
const reply = '2026-10-18T19:44:10.000Z';
const content = `<div class="voz-post" data-post-index="1" data-source-created-at="${created}"><div class="voz-post-body">Original post</div></div>`;

test('recover only original creation timestamps, including old cached reader dates', () => {
    assert.equal(vozThreadCreationTime(url, {date:reply,content}), created);
    assert.equal(vozThreadCreationTime(url, {date:created}), created);
    assert.equal(vozThreadCreationTime(url, {date:'2 hours ago',cached_at:reply}), null);
    assert.equal(vozThreadCreationTime(url, {date:reply,pagination:{currentPage:2}}), null);
    assert.equal(vozThreadCreationTime(url+'/page-2', {date:reply}), null);
    assert.equal(vozThreadCreationTime('https://example.org/article', {date:reply}), null);
});

test('cached thread dates reach cards without repeated body reads and update on cache writes', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rss-card-time-'));
    const previous = process.cwd();
    try {
        process.chdir(directory);
        await fs.mkdir('article_cache');
        const filename = `article_cache/${fnv1a(url)}.json`;
        await fs.writeFile(filename, JSON.stringify({version:61,cachedAt:Date.now(),url,result:{date:created,content}}));
        const cache = createArticleCache({_writeJsonAtomic: (file, data) => fs.writeFile(file, JSON.stringify(data))});
        assert.deepEqual(await Promise.all(Array.from({length:4}, () => cache.getCachedThreadCreationTime(url))),
            Array(4).fill(created), 'concurrent first cards recover the original creation date');
        const readFile = fs.readFile;
        fs.readFile = async () => { throw Error('Card must not reread the thread body'); };
        try {
            assert.equal(await cache.getCachedThreadCreationTime(url+'/unread'), created);
            assert.equal(await cache.getCachedThreadCreationTime(url+'/page-2'), created);
            const presentation = createArticlePresentation({getCachedThreadCreationTime:cache.getCachedThreadCreationTime});
            const article = {link:url+'/unread',title:'Thread',pubDate:reply,createDate:null};
            const prepared = await presentation.prepareArticleForClient(article);
            assert.equal(prepared.createDate, created);
            assert.equal(article.createDate, null, 'response preparation preserves stored feed objects');
        } finally { fs.readFile = readFile; }
        const newer = '2026-10-18T10:50:00.000Z';
        assert.equal(await cache.cacheArticleResult(url, {date:newer,content:content.replace(created,newer)}), true);
        assert.equal(await cache.getCachedThreadCreationTime(url), newer);
        await cache.deleteCachedArticle(url);
        assert.equal(await cache.getCachedThreadCreationTime(url), null);
    } finally {
        process.chdir(previous);
        await fs.rm(directory, {recursive:true,force:true});
    }
});

test('opening an article immediately supplies the card date, excluding cached reply pages', () => {
    const sandbox = vm.createContext({URL,Date});
    vm.runInContext(readFileSync(new URL('../public/js/article/card-source-time.js', import.meta.url),'utf8'),sandbox);
    const resolve = vm.runInContext('ReaderCardSourceTime.value.bind(ReaderCardSourceTime)',sandbox);
    const article = {link:url+'/unread',pubDate:reply};
    assert.equal(resolve(article,null,new Map([[url+'/page-2',{date:reply,pagination:{currentPage:2}}]])),null);
    assert.equal(resolve(article,null,new Map([[url,{date:created,pagination:{currentPage:1}}]])),created);
    assert.equal(resolve(article,null,new Map([['https://voz.vn/t/other.124',{date:reply}]])),null);
    assert.equal(resolve({...article,createDate:'invalid',source_created_at:created},null),created);
});
