import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const script = fs.readFileSync(new URL('../script.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('cache clearing stays available except for confirmed deleted-source snapshots', () => {
    const routeStart = server.indexOf("app.post('/api/clear-article-cache'");
    assert.notEqual(routeStart, -1);
    const routeBody = server.slice(routeStart, server.indexOf('\nasync function buildDeletedSourceResponse', routeStart));
    assert.match(server, /async function isProtectedDeletedSourceSnapshot\(url\)/);
    assert.match(server, /cachedArticle\?\.sourceDeleted === true/);
    assert.match(routeBody, /await isProtectedDeletedSourceSnapshot\(url\)/);
    assert.match(routeBody, /status\(403\)/);
    assert.match(routeBody, /Deleted-source snapshots are protected from cache clearing/);
    assert.match(routeBody, /await deleteCachedArticle\(url\)/);
    assert.match(script, /async clearArticleCache\(\)/);
    assert.match(script, /if \(this\.overlayArticle\.sourceDeleted\) \{[\s\S]*protected and cannot be refreshed/);
    assert.match(html, /x-show="overlayFetchedFromCache && overlayArticle && !overlayArticle\.sourceDeleted"[\s\S]*@click="clearArticleCache"/);
});

test('reader-method rejection stays available except for confirmed deleted-source snapshots', () => {
    const endpointStart = server.indexOf("app.get('/api/article-content'");
    assert.notEqual(endpointStart, -1);
    const endpointPrefix = server.slice(endpointStart, endpointStart + 2200);
    assert.match(endpointPrefix, /const hasProtectedDeletedSnapshot = await isProtectedDeletedSourceSnapshot\(requestedUrl\)/);
    assert.match(endpointPrefix, /hasMethodRejection && hasProtectedDeletedSnapshot/);
    assert.match(endpointPrefix, /status\(403\)/);
    assert.match(endpointPrefix, /Deleted-source snapshots are protected from reader-method rejection/);
    assert.match(endpointPrefix, /if \(hasProtectedDeletedSnapshot\)[\s\S]*buildDeletedSourceResponse\(requestedUrl\)/);
    assert.match(server, /const rejectedStrategy = String\(req\.query\.reject \|\| ''\)\.trim\(\)/);
    assert.match(server, /String\(req\.query\.exclude \|\| ''\)\.split\(','\)/);
    assert.match(server, /recordArticleFetchOutcome\(hostname, rejectedStrategy, false, 'Rejected by user'\)/);
    assert.match(script, /async rejectAndTryNextArticleMethod\(\)/);
    assert.match(script, /if \(this\.overlayArticle\.sourceDeleted\) \{[\s\S]*protected and cannot reject reader methods/);
    assert.match(html, /x-show="overlayArticle && !overlayArticle\.sourceDeleted"[\s\S]*@click="rejectAndTryNextArticleMethod\(\)"/);
    assert.match(html, /overlayRejectedStrategies\.includes\(strategy\)/);
});

test('canonical publisher URLs cannot be overwritten by their malformed request form', () => {
    const endpointStart = server.indexOf("app.get('/api/article-content'");
    const endpointEnd = server.indexOf('\nasync function parseArticleHtmlContent', endpointStart);
    const endpoint = server.slice(endpointStart, endpointEnd);
    assert.match(endpoint, /let url = normalizeArticleSourceUrl\(requestedUrl\)/);
    assert.match(endpoint, /if \(!isGoogleNewsArticleUrl\(requestedUrl\)\) \{[\s\S]*url = normalizeArticleSourceUrl\(requestedUrl\)/);
    assert.doesNotMatch(endpoint, /if \(!isGoogleNewsArticleUrl\(requestedUrl\)\) \{[\s\S]{0,300}resolveGoogleNewsUrl\(requestedUrl/);
    assert.match(server, /async function fetchArticleHtmlByStrategy\(strategy, url\) \{\s*url = normalizeArticleSourceUrl\(url\)/);
    assert.match(server, /async function fetchParsedArticleByStrategy\(strategy, url,[\s\S]{0,120}\{\s*url = normalizeArticleSourceUrl\(url\)/);
});

test('deleted-source warning is a dedicated subdued liquid-glass alert', () => {
    assert.match(html, /class="source-deleted-warning" role="alert" aria-live="polite"/);
    assert.match(html, /class="source-deleted-warning__icon"/);
    assert.match(html, /class="source-deleted-warning__title"/);
    assert.match(html, /\.theme-glass-light \.source-deleted-warning \{[\s\S]*backdrop-filter: blur\(24px\) saturate\(125%\)/);
    assert.match(html, /last successfully cached copy; the reader will not contact the original source again/);
    assert.match(html, /No cached copy is available, and the reader will not retry the original source/);
    assert.doesNotMatch(server, /VOZ_DELETED_WARNING_BANNER|class="voz-warning"/);
});

test('article cards retain the original seamless image mask without an overlay seam', () => {
    assert.match(html, /\.theme-glass-light \.article-card \{[\s\S]*transform: translateY\(-3px\) scale\(1\.005\);/);
    assert.match(html, /\.article-card img\.thumbnail-img \{[\s\S]*-webkit-mask-image: linear-gradient\(to right,[\s\S]*transparent 0%,[\s\S]*rgba\(0, 0, 0, 1\) 35%\) !important;/);
    assert.doesNotMatch(html, /article-card-media/);
    assert.doesNotMatch(html, /\.article-card-media::after/);
});

test('light article sections share one neutral parent surface between cards', () => {
    assert.match(html, /\.theme-glass-light \.article-overlay-panel\s*\{[^}]*background:\s*#f7f7f7 !important;[^}]*background-image:\s*none !important;[^}]*backdrop-filter:\s*none !important;/);
    assert.match(html, /\.theme-glass-light #overlay-scroll-container,\s*\.theme-glass-light \.article-rendered-content\s*\{[^}]*background-color:\s*#f7f7f7 !important;[^}]*background-image:\s*none !important;[^}]*backdrop-filter:\s*none !important;/);
    assert.match(html, /\.theme-glass-light \.voz-post\s*\{[^}]*box-shadow:[^}]*0 2px 8px -7px rgba\(15, 23, 42, 0\.35\)/);
    assert.doesNotMatch(html, /#overlay-scroll-container > \*,\s*\.article-rendered-content[\s\S]{0,160}max-width:\s*100%/);
});

test('all Alpine-bound reader settings exist before the first render', () => {
    assert.match(script, /smartSourceSort: 'score'/);
    assert.match(script, /editFeedFetchMethods: \[\]/);
    assert.match(script, /editFeedExcludeFromSmart: false/);
    assert.match(script, /overlayRemainingAvailable: false/);
    assert.match(html, /<script src="\/script\.js\?v=20_full_height_x_embeds"><\/script>/);
    assert.match(html, /class="mt-2 text-\[11px\] text-gray-400 space-y-0\.5"\s+x-data="\{ healthType:/);
    assert.match(html, /x-for="\(item, idx\) in \(debugData\?\.prefetchQueue \|\| \[\]\)"/);
    assert.match(html, /:title="overlayArticle && savedStates\.includes\(overlayArticle\.link\) \? 'Remove from Read Later' : 'Read Later'"/);
    assert.match(html, /:title="overlayArticle && boardStates\.includes\(overlayArticle\.originalLink \|\| overlayArticle\.link\) \? 'Remove from Board' : 'Save to Board'"/);
});
