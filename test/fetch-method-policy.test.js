import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const script = readFileSync(new URL('../script.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('a non-empty source method selection is a strict allowlist', () => {
    const policyBlock = server.slice(
        server.indexOf('async function getArticleFetchPolicy'),
        server.indexOf('async function getArticleFetchPreferences')
    );
    assert.match(policyBlock, /hasStrictConfiguredMethods/);
    assert.match(policyBlock, /availableStrategies = hasStrictConfiguredMethods[\s\S]*configuredAvailableStrategies/);
    assert.match(policyBlock, /allAvailableStrategies\.filter\(method => hasStrictConfiguredMethods/);

    const route = server.slice(
        server.indexOf("app.get('/api/article-content'"),
        server.indexOf('async function parseArticleHtmlContent')
    );
    assert.match(route, /Fetch method .* is not allowed for this source/);
    assert.match(route, /policy\.hasStrictConfiguredMethods \|\| req\.query\.fallback !== 'true'/);
    assert.match(route, /Failed to fetch article using the methods selected for this source/);
    assert.doesNotMatch(route, /remainingAvailable:\s*true/);
});

test('all browser article requests preserve source identity', () => {
    assert.match(script, /new URLSearchParams\(\{\s*url: link,\s*feedUrl: sourceArticle\?\.feedUrl \|\| ''/);
    assert.match(script, /url: targetUrl,\s*feedUrl: this\.overlayArticle\?\.feedUrl \|\| ''/);
    assert.match(script, /prefetchTargets\.push\(\{\s*url: u,[\s\S]*feedUrl: nextArticle\?\.feedUrl \|\| ''/);
    assert.match(script, /if \(this\.articleContentCache\) this\.articleContentCache\.clear\(\)/);
});

test('every background worker dispatches only through the resolved policy', () => {
    const dispatcher = server.slice(
        server.indexOf('async function fetchParsedArticleByStrategy'),
        server.indexOf('async function discoverArticleAudioUrls')
    );
    assert.match(dispatcher, /strategy === 'jina'/);
    assert.match(dispatcher, /strategy === 'opencli'/);

    for (const functionName of [
        'triggerVozNextPagePrefetch',
        'triggerVozCurrentPageBackgroundUpdate',
        'triggerNextFiveArticlesPrefetch',
        'runUniversalTabPrefetch'
    ]) {
        const start = server.indexOf(`function ${functionName}`) >= 0
            ? server.indexOf(`function ${functionName}`)
            : server.indexOf(`async function ${functionName}`);
        assert.notEqual(start, -1, `${functionName} should exist`);
        const nextFunction = server.indexOf('\nfunction ', start + 10);
        const nextAsyncFunction = server.indexOf('\nasync function ', start + 10);
        const candidates = [nextFunction, nextAsyncFunction].filter(index => index > start);
        const end = candidates.length ? Math.min(...candidates) : server.length;
        const body = server.slice(start, end);
        assert.match(body, /getArticleFetchPolicy\(/, `${functionName} should resolve policy`);
        assert.match(body, /fetchParsedArticleByStrategy\(/, `${functionName} should use policy dispatcher`);
    }
});

test('OpenCLI-only feed and Smart sources prefetch new article content during ingestion', () => {
    assert.match(server, /function hasOnlyOpenCliFetchMethod\(methods\)/);
    assert.match(server, /openCliOnlyArticlesToPrefetch\.push\(articleRecord\)/);
    assert.match(server, /await prefetchOpenCliOnlyArticles\(openCliOnlyArticlesToPrefetch, feed\.url\)/);
    assert.doesNotMatch(server, /!historyStatsMap\.has\(safeLink\) && hasOnlyOpenCliFetchMethod/);
    assert.match(server, /fetchParsedArticleByStrategy\([\s\S]*'opencli'[\s\S]*cacheArticleResult/);

    const smartNews = readFileSync(new URL('../smart-news.js', import.meta.url), 'utf8');
    assert.match(smartNews, /prefetchOpenCliOnlySmartArticles/);
    assert.match(smartNews, /result\?\.source\?\.fetchMethods/);
    assert.match(smartNews, /helpers\.prefetchOpenCliOnlyArticles\(articlesToPrefetch, result\.source\.url\)/);
    assert.match(server, /helpers: \{ fastParseRSS, waitForHttpIdle, prefetchOpenCliOnlyArticles, resolveSmartArticleDestinations \}/);
});

test('Edit Source uses light liquid glass controls with a complete checkbox border', () => {
    assert.match(html, /class="edit-source-backdrop/);
    assert.match(html, /class="edit-source-panel/);
    assert.match(html, /class="edit-source-primary-button/);
    assert.match(html, /class="edit-source-checkbox"/);
    assert.match(html, /\.edit-source-checkbox \{[\s\S]*border: 1\.5px solid/);
    assert.match(html, /\.edit-source-panel \{[\s\S]*border-radius: 28px/);
    assert.match(html, /\.theme-glass-light \.edit-source-panel/);
    assert.match(html, /\.theme-glass-light \.edit-source-primary-button \{[\s\S]*color: #ffffff !important/);
    assert.match(html, /Strict allowlist/);
    assert.match(html, /only those methods are allowed for this source/);
});

test('Smart sources expose and enforce their own article fetch allowlists', () => {
    assert.match(html, /smartSourceFetchOpenUrl/);
    assert.match(html, /Fetch · Auto/);
    assert.match(html, /@click\.stop="toggleSmartSourceFetchPanel\(source\)"/);
    assert.match(html, /toggleSmartSourceFetchMethod\(source, method\.value\)/);
    assert.match(script, /toggleSmartSourceFetchPanel\(source\)/);
    assert.match(script, /async toggleSmartSourceFetchMethod\(source, method\)/);
    assert.match(html, /script\.js\?v=32_pdf_destination/);
    assert.match(server, /smartNews\.getSourceSettings\(\)/);
    assert.match(server, /configuredSources = \[\.\.\.feeds, \.\.\.smartSources\]/);
    assert.match(server, /smartNews\.setSourceFetchMethods/);
});

test('publisher fetch policies synchronize between normal feeds and every Smart category', () => {
    assert.match(server, /sourceFetchPolicyIdentity/);
    assert.match(server, /async function synchronizeConfiguredSourceFetchMethods/);
    assert.match(server, /smartNews\.setSourceFetchMethodsByIdentity/);
    assert.match(server, /reconcileAllConfiguredSourceFetchMethods/);
    assert.match(server, /if \(!targetFeedUrl\) \{\s*await reconcileAllConfiguredSourceFetchMethods\(\)/);
    assert.match(server, /res\.status\(200\)\.json\(\{ ok: true, \.\.\.synchronized \}\)/);
    assert.match(script, /if \(Array\.isArray\(data\.feeds\)\) this\.feeds = data\.feeds/);
    assert.match(script, /if \(Array\.isArray\(data\?\.sources\)\) this\.smartSources = data\.sources/);
});
