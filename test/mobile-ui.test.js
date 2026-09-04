import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const script = readFileSync(new URL('../script.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('mobile and desktop sidebar buttons use the shared toggle', () => {
    assert.match(script, /toggleSidebar\(\)\s*\{[\s\S]*this\.mobileSidebarOpen = !this\.mobileSidebarOpen;[\s\S]*this\.sidebarExpanded = !this\.sidebarExpanded;/);
    assert.equal((html.match(/@click="toggleSidebar\(\)"/g) || []).length, 3);
    assert.doesNotMatch(html, /@click="mobileSidebarOpen = true"/);
});

test('clicking outside an open sidebar closes it and toggle icons expose their state', () => {
    assert.match(script, /closeSidebar\(\)\s*\{[\s\S]*this\.mobileSidebarOpen = false;[\s\S]*this\.sidebarExpanded = false;/);
    assert.equal((html.match(/@click="closeSidebar\(\)"/g) || []).length, 2);
    assert.match(html, /x-show="isLoggedIn && sidebarExpanded && !isMobile"[^>]*@click="closeSidebar\(\)"/);
    assert.equal((html.match(/'M6 18 18 6M6 6l12 12'/g) || []).length, 3);
    assert.equal((html.match(/\? 'Close sidebar' : 'Open sidebar'/g) || []).length, 6);
});

test('touch movement and feed scrolling dismiss the tooltip', () => {
    assert.match(html, /@touchmove\.window\.passive="hideTooltip\(\)"/);
    assert.match(html, /id="scroll-container" @scroll\.passive="hideTooltip\(\)"/);
});

test('article tooltips have one pointer-aware lifecycle and comprehensive dismissal', () => {
    assert.match(html, /data-tooltip-trigger[\s\S]*@pointerenter="showTooltip\([\s\S]*@pointerleave="hideTooltip\(\)"[\s\S]*@pointercancel="hideTooltip\(\)"/);
    assert.doesNotMatch(html, /@mouseenter="showTooltip/);
    assert.match(script, /installTooltipDismissListeners\(\)[\s\S]*new AbortController\(\)/);
    assert.match(script, /window\.addEventListener\('blur', dismiss/);
    assert.match(script, /window\.addEventListener\('resize', dismiss/);
    assert.match(script, /window\.addEventListener\('scroll', dismiss, \{ capture: true/);
    assert.match(script, /document\.addEventListener\('pointerdown'/);
    assert.match(script, /document\.addEventListener\('focusin'/);
    assert.match(script, /pointerType === 'touch'/);
    assert.match(html, /@keydown\.escape\.window="hideTooltip\(\); if\(articleOverlayOpen\) closeArticleOverlay\(\)"/);
});

test('VOZ reaction names wrap instead of truncating on mobile', () => {
    assert.match(html, /@media \(max-width: 640px\) \{[\s\S]*?\.voz-post \.voz-like-users \{[\s\S]*?white-space: normal !important;[\s\S]*?overflow: visible !important;[\s\S]*?text-overflow: clip !important;/);
});

test('VOZ inline images align to the surrounding text baseline', () => {
    assert.match(html, /\.voz-post-body \.bbImageWrapper \{[^}]*vertical-align: baseline !important;/);
    assert.doesNotMatch(html, /\.voz-post-body \.bbImageWrapper \{[^}]*vertical-align: middle !important;/);
});

test('Smart News restores compact cards immediately and revalidates without blanking them', () => {
    assert.match(html, /window\.__rssInitialDataRequest[\s\S]*promise: fetch/);
    assert.match(script, /saveState\(\) \{[\s\S]*compactArticle[\s\S]*relatedArticles[\s\S]*sessionStorage, localStorage/);
    assert.match(script, /setTimeout\(\(\) => this\.fetchData\(false, true, true\), 50\)/);
    assert.match(script, /async fetchData\(isLoadMore = false, skipPageReset = false, keepVisible = false\)/);
    assert.match(script, /if \(!keepVisible\) this\.articles = \[\];/);
    assert.match(script, /if \(keepVisible && this\.articles\.length > 0\)[\s\S]*this\.articles = this\.articles\.map/);
    assert.match(script, /canUseEarlyRequest[\s\S]*await earlyRequest\.promise/);
});

test('background user-state sync does not remove or reorder visible cards', () => {
    const syncMethod = script.match(/async syncUserStatesInBackground\(\) \{([\s\S]*?)\n\s*\},\n\n\s*async syncNow/);
    assert.ok(syncMethod);
    assert.doesNotMatch(syncMethod[1], /this\.articles\s*=\s*this\.articles\.filter/);
});

test('article image shadows can feather beyond content while the overlay contains horizontal overflow', () => {
    assert.match(html, /#overlay-scroll-container\s*\{[^}]*overflow-x:\s*hidden;/);
    assert.match(html, /\.article-rendered-content img\s*\{[^}]*box-shadow:\s*0 16px 40px/);
    assert.doesNotMatch(html, /\.article-rendered-content\s*\{[^}]*overflow-x:\s*(?:clip|hidden);/);
});

test('Smart News API bypasses the regular article database path', () => {
    const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
    const smartNews = readFileSync(new URL('../smart-news.js', import.meta.url), 'utf8');
    assert.match(server, /if \(filterType === 'smart'\) return serveSmartData\(req, res\);/);
    assert.match(server, /get\('smartClusters', \{ type: 'json', shared: true \}\)/);
    assert.match(server, /Server-Timing.*smart-data/);
    assert.match(server, /helpers: \{ fastParseRSS, waitForHttpIdle, prefetchOpenCliOnlyArticles, resolveSmartArticleDestinations \}/);
    assert.match(server, /skipped while HTTP requests are active/);
    assert.match(server, /max-age=31536000, immutable/);
    assert.match(server, /no-cache, must-revalidate/);
    assert.match(server, /await waitForHttpIdle\(\);[\s\S]{0,240}const cycleStart/);
    assert.match(smartNews, /'articles',[\s\S]{0,240}type: 'json',[\s\S]{0,80}shared: true/);
    assert.match(smartNews, /typeof helpers\.waitForHttpIdle === 'function'/);
});

test('article reader URLs preserve the active filter and contain one canonical article parameter', () => {
    assert.match(script, /filterHash\(articleUrl = ''\)[\s\S]*\?article=\$\{encodeURIComponent\(articleUrl\)\}/);
    assert.match(script, /updateArticleRoute\(articleOrUrl, replace = false\)/);
    assert.match(script, /const articleMarker = '\?article='/);
    assert.match(script, /openArticleFromRoute\(hashFilter\.articleUrl\)/);
    assert.match(html, /@hashchange\.window="handleHashChange\(\)" @popstate\.window="handleHashChange\(\)"/);
    assert.match(html, /navigator\.clipboard\.writeText\(window\.location\.href\)/);
});

test('related articles use a stacked reader and close back to the previous article', () => {
    assert.match(script, /articleOverlayStack: \[\]/);
    assert.match(script, /openRelatedArticle\(article, event = null\)/);
    assert.match(script, /this\.articleOverlayStack\.push\(this\.captureArticleOverlay\(\)\)/);
    assert.match(script, /const previous = this\.articleOverlayStack\.pop\(\);[\s\S]*this\.restoreArticleOverlay\(previous/);
    assert.match(script, /\.embedded-suggested-card a, a\.styled-rel-card, a\.tuoitre-event-stream__item-link/);
    assert.match(html, /@click\.prevent\.stop="openRelatedArticle\(related, \$event\)"/);
    assert.match(html, /Back to previous article/);
});

test('hidden count revalidates from authoritative server state', () => {
    assert.match(script, /this\.hiddenStates = this\.dedupeStateLinks\(data\.hiddenStates \|\| \[\]\)/);
    assert.match(script, /if \(data\.hiddenStates\) this\.hiddenStates = this\.dedupeStateLinks\(data\.hiddenStates\)/);
    assert.match(html, /x-text="hiddenArticleCount\(\) \|\| ''"/);
    assert.doesNotMatch(script, /data\.hiddenStates \|\| \[\]\), \.\.\.this\.hiddenStates/);
});
