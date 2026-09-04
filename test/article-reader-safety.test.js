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
    assert.match(server, /exactCachedArticle\?\.sourceDeleted === true/);
    assert.match(server, /threadCachedArticle\?\.sourceDeleted === true/);
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
    const endpointPrefix = server.slice(endpointStart, endpointStart + 3200);
    assert.match(endpointPrefix, /const hasProtectedDeletedSnapshot = await isProtectedDeletedSourceSnapshot\(requestedUrl\)/);
    assert.match(endpointPrefix, /hasMethodRejection && hasProtectedDeletedSnapshot/);
    assert.match(endpointPrefix, /status\(403\)/);
    assert.match(endpointPrefix, /Deleted-source snapshots are protected from reader-method rejection/);
    assert.match(endpointPrefix, /shouldRevalidateProtectedSnapshot[\s\S]*clearUnavailableSourceUrl\(requestedUrl\)/);
    assert.match(endpointPrefix, /if \(hasProtectedDeletedSnapshot && !shouldRevalidateProtectedSnapshot\)[\s\S]*buildDeletedSourceResponse\(requestedUrl\)/);
    assert.match(server, /const rejectedStrategy = String\(req\.query\.reject \|\| ''\)\.trim\(\)/);
    assert.match(server, /String\(req\.query\.exclude \|\| ''\)\.split\(','\)/);
    assert.match(server, /recordArticleFetchOutcome\(hostname, rejectedStrategy, false, 'Rejected by user'\)/);
    assert.match(script, /async rejectAndTryNextArticleMethod\(\)/);
    assert.match(script, /if \(this\.overlayArticle\.sourceDeleted\) \{[\s\S]*protected and cannot reject reader methods/);
    assert.match(html, /x-show="overlayArticle && !overlayArticle\.sourceDeleted"[\s\S]*@click="rejectAndTryNextArticleMethod\(\)"/);
    assert.match(html, /overlayRejectedStrategies\.includes\(strategy\)/);
});

test('ordinary articles need two independent deletion signals before a tombstone is created', () => {
    const endpointStart = server.indexOf("app.get('/api/article-content'");
    const endpointEnd = server.indexOf('\nasync function parseArticleHtmlContent', endpointStart);
    const endpoint = server.slice(endpointStart, endpointEnd);
    assert.match(server, /return !isVozThreadUrl\(url\)/);
    assert.match(endpoint, /const deletionEvidence = new Set\(\)/);
    assert.match(endpoint, /deletionEvidence\.size >= 2/);
    assert.match(endpoint, /deletionConfirmedBy: \[\.\.\.deletionEvidence\]/);
    assert.match(server, /shouldRevalidateUnconfirmedArticle/);
    assert.match(server, /protectedDeletedSnapshot\.deletionConfirmedBy\.length < 2/);
});

test('Techmeme related links and X cards survive shared article cleaning', () => {
    assert.match(server, /isTechmemeStory/);
    assert.match(server, /\.techmeme-x-posts, \.techmeme-primary-article/);
    assert.match(server, /if \(!isTechmemeStory\) \{/);
    assert.match(server, /node\.closest\('\.techmeme-x-posts'\)\.length > 0/);
    assert.match(html, /\.theme-glass-light \.article-rendered-content \.techmeme-x-posts/);
    assert.match(html, /\.techmeme-x-post__profile/);
    assert.match(html, /\.article-rendered-content \.techmeme-x-post__profile-image \{[\s\S]*margin: 0 !important;[\s\S]*object-fit: cover;[\s\S]*box-shadow: none;/);
    assert.match(html, /\.article-rendered-content \.techmeme-x-post__body:only-child \{[\s\S]*grid-column: 1 \/ -1;/);
    assert.doesNotMatch(html, /\.techmeme-x-post__avatar/);
    assert.match(html, /class="article-primary-source-badge flex items-center/);
    assert.match(html, /\.theme-glass-light \.article-primary-source-badge \{[\s\S]*background: rgba\(255, 255, 255, 0\.72\) !important/);
    assert.doesNotMatch(html, /class="[^"]*bg-sky-950\/75[^"]*"/);
});

test('deleted VOZ pagination serves the exact cached page instead of page one', () => {
    const functionStart = server.indexOf('async function buildDeletedSourceResponse');
    const functionEnd = server.indexOf('\n// --- ARTICLE CONTENT EXTRACTION ENDPOINT ---', functionStart);
    const functionBody = server.slice(functionStart, functionEnd);

    assert.match(functionBody, /const requestedCacheUrl = normalizeArticleSourceUrl\(url\)/);
    assert.match(functionBody, /const requestedVozPage = getVozThreadPageNumber\(requestedCacheUrl\)/);
    assert.match(functionBody, /const isSpecificVozPage = requestedVozPage !== null && requestedVozPage > 1/);
    assert.match(functionBody, /const snapshotUrl = isSpecificVozPage \? requestedCacheUrl : baseUrl/);
    assert.match(functionBody, /getLastKnownCachedArticle\(snapshotUrl\)/);
    assert.match(server, /async function getArchivedVozPaginationSeed\(baseUrl\)/);
    assert.match(server, /!cached\.content\.includes\(DELETED_SOURCE_TOMBSTONE\)/);
    assert.match(functionBody, /getArchivedVozPaginationSeed\(baseUrl\)/);
    assert.match(functionBody, /alignVozPaginationToRequestedPage/);
    assert.match(functionBody, /cacheArticleResult\(snapshotUrl, preserved\)/);
    assert.match(functionBody, /url: snapshotUrl/);
});

test('deleted articles without a cached copy are removed from active Smart News views', () => {
    const functionStart = server.indexOf('async function buildDeletedSourceResponse');
    const functionEnd = server.indexOf('\n// --- ARTICLE CONTENT EXTRACTION ENDPOINT ---', functionStart);
    const functionBody = server.slice(functionStart, functionEnd);

    assert.match(server, /function markUnavailableSourceUrl\(url\)/);
    assert.match(functionBody, /if \(!hasCachedContent\) await markUnavailableSourceUrl\(snapshotUrl\)/);
    assert.match(server, /function removeUnavailableSmartSources\(article, unavailableSet\)/);
    assert.match(server, /get\('unavailableSourceUrls', \{ type: 'json' \}\)/);
    assert.match(server, /\.map\(article => removeUnavailableSmartSources\(article, unavailableSet\)\)/);
    assert.match(script, /data\.sourceDeleted === true && data\.sourceDeletedHasCache === false[\s\S]*closeArticleOverlay\(\{ closeAll: true \}\)[\s\S]*fetchData\(false, true, true\)/);
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

test('Google News cards fetch and route to the resolved publisher while keeping their stable original identity', () => {
    assert.match(script, /articleReaderUrl\(articleOrUrl\)[\s\S]*articleOrUrl\?\.resolvedLink \|\| articleOrUrl\?\.link \|\| articleOrUrl\?\.originalLink/);
    assert.match(script, /articleRouteUrl\(articleOrUrl\) \{[\s\S]*this\.articleReaderUrl\(articleOrUrl\)/);
    assert.match(script, /let targetUrl = this\.articleReaderUrl\(article\)/);
    assert.match(script, /this\.isGoogleNewsArticleUrl\(this\.overlayArticle\.link\)[\s\S]*this\.overlayArticle\.link = data\.url/);
    assert.match(script, /this\.updateArticleRoute\(this\.overlayArticle, true\)/);
    assert.match(script, /this\.markAsReadExplicit\(article\.originalLink \|\| article\.link\)/);
    assert.match(server, /resolveGoogleNewsViaOpenCliSearch\(hints\)/);
    assert.match(server, /'duckduckgo', 'search', query/);
});

test('publisher press-and-hold challenges are rejected and The Hill OpenCLI reads its public AMP page', () => {
    assert.match(server, /press\\s\*\(\?:&\|and\)\\s\*hold\\s\+to confirm you are a human/);
    assert.match(server, /sourceHandler\?\.getOpenCliReaderUrl\?\.\(url\)/);
    assert.match(server, /'web', 'read', '--url', readerCandidates\[index\]/);
});

test('device-verification pages are rejected after a source-specific OpenCLI wait', () => {
    assert.match(server, /sourceHandler\?\.getOpenCliWaitSeconds\?\.\(\)/);
    assert.match(server, /sourceHandler\?\.getOpenCliFallbackReaderUrls\?\.\(url\)/);
    assert.match(server, /OpenCLI remained on the publisher device-verification page after waiting/);
    assert.match(server, /requested content will be available after verification/);
    assert.match(server, /captcha-delivery\\\.com\\\/interstitial/);
});

test('deleted-source warning is a dedicated subdued liquid-glass alert', () => {
    assert.match(html, /x-show="!isLoadingOverlay && !overlayError && \(overlayContent \|\| \(overlayArticle && overlayArticle\.sourceDeleted\)\)"/);
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
    assert.match(script, /url\.startsWith\('\/api\/og-image'\)[\s\S]*versioned\.searchParams\.set\('v', '32'\)/);
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
    assert.match(html, /<script src="\/script\.js\?v=[^"]+"><\/script>/);
    assert.match(html, /class="mt-2 text-\[11px\] text-gray-400 space-y-0\.5"\s+x-data="\{ healthType:/);
    assert.match(html, /x-for="\(item, idx\) in \(debugData\?\.prefetchQueue \|\| \[\]\)"/);
    assert.match(html, /:title="overlayArticle && savedStates\.includes\(overlayArticle\.link\) \? 'Remove from Read Later' : 'Read Later'"/);
    assert.match(html, /:title="overlayArticle && boardStates\.includes\(overlayArticle\.originalLink \|\| overlayArticle\.link\) \? 'Remove from Board' : 'Save to Board'"/);
});

test('article reader can copy rich content with images, links, and a plain-text fallback', () => {
    assert.match(html, /@click="copyArticleContent\(\)"/);
    assert.match(html, /Copy article content with images/);
    assert.match(script, /buildArticleClipboardPayload\(\)/);
    assert.match(script, /content\.querySelectorAll\('img'\)/);
    assert.match(script, /resolved\.pathname === '\/api\/proxy-image'/);
    assert.match(script, /const rawHero = this\.overlayArticle\.overlayImage \|\| this\.overlayArticle\.image/);
    assert.match(script, /!copiedImages\.some\(image => image\.src === portableHero\)/);
    assert.match(script, /'text\/html': new Blob\(\[payload\.html\]/);
    assert.match(script, /'text\/plain': new Blob\(\[payload\.text\]/);
    assert.match(script, /copyArticleHtmlLegacy\(payload\.html\)/);
    assert.match(script, /navigator\.clipboard\.writeText\(payload\.text\)/);
});

test('article reader can save every article as PDF and collect VOZ pages with progress and cancellation', () => {
    assert.match(html, /@click="saveArticleAsPdf\(\)"/);
    assert.match(html, /Save article as PDF/);
    assert.match(html, /articlePdfProgress\.current/);
    assert.match(html, /@click="cancelArticlePdf\(\)"/);
    assert.match(script, /async collectVozThreadForPdf\(signal\)/);
    assert.match(script, /for \(let page = 1; page <= totalPages && page <= 250; page\+\+\)/);
    assert.match(script, /params\.set\('bypassCache', '1'\)/);
    assert.match(script, /this\.articlePdfAbortController\.abort\(\)/);
    assert.match(script, /printWindow\.print\(\)/);
});
