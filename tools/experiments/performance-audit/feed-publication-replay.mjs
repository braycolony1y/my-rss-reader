import {readFile, writeFile} from 'node:fs/promises';
import registry from '../../../src/sources/index.js';
import {createFeedSync} from '../../../src/feeds/sync.js';
import {addMemoryUpdates} from '../../../test/helpers/memory-updates.js';

// An isolated, gated feed adapter reproduces overlap without publisher traffic,
// user data, model calls, or changes to the service database.
export async function replayFeedPublication({baselineFile, output}) {
    const sourceUrl = new URL('../../../src/feeds/sync.js', import.meta.url);
    const original = await readFile(baselineFile, 'utf8');
    const resolved = original.replace(/from (['"])(\.[^'"]+)\1/g,
        (_, quote, relative) => `from ${quote}${new URL(relative, sourceUrl).href}${quote}`);
    const baseline = await import('data:text/javascript;base64,' + Buffer.from(resolved).toString('base64'));
    const reports = [];
    const originalHandler = registry.getHandler;
    try {
        for (const [variant, create] of [['before', baseline.createFeedSync], ['after', createFeedSync]]) {
            const feed = name => ({url: `https://${name}.example.test/rss`, title: name, category: 'News'});
            const a = feed('a'), b = feed('b'), c = feed('c');
            const values = {feeds: [a, b], articles: []};
            const db = addMemoryUpdates({
                get: async key => structuredClone(values[key] || []),
                putMany: async changes => {
                    for (const [key, value] of Object.entries(changes)) values[key] = JSON.parse(value);
                }
            }, values);
            const env = {RSS_DATA: db};
            let release, signal, calls = 0, active = 0, peak = 0;
            const gate = new Promise(resolve => {release = resolve;});
            const started = new Promise(resolve => {signal = resolve;});
            registry.getHandler = () => ({fetchFeed: async url => {
                calls++; active++; peak = Math.max(peak, active); signal();
                await gate;
                active--;
                return {items: [{link: url + '/story', title: url, content: 'Fixture story',
                    pubDate: '2026-11-05T00:00:00Z', image: 'https://example.test/photo.jpg'}]};
            }});
            const sync = create({env, recordFetch() {}, hasOnlyOpenCliFetchMethod: () => false,
                prefetchOpenCliOnlyArticles: async () => {}, computeUniversalPrefetchList: async () => [],
                reconcileAllConfiguredSourceFetchMethods: async () => {}});
            const begin = performance.now();
            const requests = Array.from({length: 8}, () => sync.syncFeeds(env));
            await started;
            values.feeds = [{...a, title: 'User edit'}, c];
            values.articles = [{feedUrl: c.url, link: c.url + '/concurrent', title: 'Concurrent article',
                pubDate: '2026-11-05T00:00:00Z', image: 'https://example.test/photo.jpg'}];
            release(); await Promise.all(requests);
            reports.push({variant, callerCount: requests.length, fetchCalls: calls, peakConcurrentFetches: peak,
                elapsedMs: performance.now() - begin,
                userFeedEditPreserved: values.feeds.some(row => row.title === 'User edit'),
                addedFeedPreserved: values.feeds.some(row => row.url === c.url),
                removedFeedAbsent: !values.feeds.some(row => row.url === b.url),
                concurrentArticlePreserved: values.articles.some(row => row.link.endsWith('/concurrent')),
                removedFeedArticlesAbsent: !values.articles.some(row => row.feedUrl === b.url)});
        }
    } finally {registry.getHandler = originalHandler;}
    await writeFile(output, JSON.stringify(reports, null, 2));
    return reports;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
    console.log(JSON.stringify(await replayFeedPublication({baselineFile: process.argv[2], output: process.argv[3]})));
}
