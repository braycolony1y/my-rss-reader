import { startSmartSyncLoop, scheduleMonthlySourceEvaluation } from '../../smart-news.js';
import { fastParseRSS } from '../../feed-parsers.js';
import cron from 'node-cron';
import { normalizeStateUrl } from '../utils/article-utils.js';
import { isVozThreadUrl } from '../voz-thread-state.js';

export function createBackgroundStartup({
    boardCache,
    reconcileAllConfiguredSourceFetchMethods,
    cleanupArticleCache,
    env,
    startSequentialSyncLoop,
    gcAndLogMemory,
    smartNews,
    waitForHttpIdle,
    prefetchOpenCliOnlyArticles,
    resolveSmartArticleDestinations,
    BROWSER_HEADERS,
    runUniversalTabPrefetch,
    deletedVozThreads,
    getCachedArticle,
    enqueueVozCacheBoardCrawl,
    triggerVozCurrentPageBackgroundUpdate,
    VOZ_CACHE_BOARD_REFRESH_INTERVAL_MS,
    http,
} = {}) {
    const sourceFetchPolicyStartupSync = setTimeout(() => {
        reconcileAllConfiguredSourceFetchMethods().catch(error => {
            console.error('[FETCH POLICY] Could not synchronize existing source settings:', error.message);
        });
    }, 0);

    if (sourceFetchPolicyStartupSync.unref) sourceFetchPolicyStartupSync.unref();

    // IMPORTANT: Listen FIRST, then start sync. This ensures the HTTP server is
    // always available even if the sync loop causes issues. Previously, the sync
    // loop started before listen(), which meant OOM kills during sync could
    // prevent port 3000 from ever binding.
    //
    // STAGGERED STARTUP: Heavy subsystems are started sequentially with delays
    // to prevent concurrent memory spikes that trigger OOM kills. The old approach
    // fired smartNews.start() + startSequentialSyncLoop() + startSmartSyncLoop()
    // all within 3 seconds, causing a memory spike (embedding model + 186 sources
    // + 43 feeds + HNSW clustering + prefetch) that exceeded the 3GB cgroup limit.
    const STAGGER_DELAY_MS = {
        SMART_NEWS:      30_000,  // 30s – let RSS feed sync settle first
        SMART_SYNC_LOOP: 45_000,  // 45s – fetches 186 sources, runs after smart news init
        PREFETCH:        60_000,  // 60s – non-critical, can wait
    };

    function startBackgroundServices() {

        // ── Phase 0: Lightweight housekeeping (immediate) ────────────
        cleanupArticleCache();
        const articleCacheCleanupTimer = setInterval(cleanupArticleCache, 60 * 60 * 1000);
        if (articleCacheCleanupTimer.unref) articleCacheCleanupTimer.unref();

        // ── Phase 1: RSS feed sync (immediate) ──────────────────────
        // This is the core feed sync loop – must start first so the UI
        // has fresh articles as soon as possible.
        // Give the first browser request a chance to arrive before any
        // background database or feed processing begins.
        http.lastHttpActivityAt = Date.now();
        startSequentialSyncLoop();
        console.log('[STAGGERED BOOT] Phase 1: RSS feed sync started.');

        // ── Phase 2: Smart news engine (delayed) ────────────────────
        // smartNews.start() triggers HNSW clustering + embedding model
        // load within ~2.5s. Delaying it lets RSS sync finish its initial
        // burst and release memory before the heavy clustering begins.
        setTimeout(() => {
            gcAndLogMemory('Pre-SmartNews');
            console.log('[STAGGERED BOOT] Phase 2: Starting smart news engine...');
            smartNews.start();
        }, STAGGER_DELAY_MS.SMART_NEWS);

        // ── Phase 3: Smart source sync loop (delayed further) ───────
        // Fetches articles from 186 smart sources. This is I/O-heavy and
        // accumulates large response buffers in memory.
        setTimeout(() => {
            gcAndLogMemory('Pre-SmartSyncLoop');
            console.log('[STAGGERED BOOT] Phase 3: Starting smart source sync loop...');
            startSmartSyncLoop({ fastParseRSS, waitForHttpIdle, prefetchOpenCliOnlyArticles, resolveSmartArticleDestinations, observeCacheArticles: boardCache.observe }, BROWSER_HEADERS, env.RSS_DATA, smartNews.getSources);
        }, STAGGER_DELAY_MS.SMART_SYNC_LOOP);

        // ── Phase 3b: Monthly source reputation evaluation (gemini-web) ──
        // Runs a few minutes after the sync loop starts, only when
        // lastSourceEvalTime is missing or older than 30 days. Single-flight,
        // non-blocking, and failures are logged, never thrown.
        setTimeout(() => {
            scheduleMonthlySourceEvaluation(env.RSS_DATA, smartNews.getSources).catch(error => {
                console.error('[SMART EVAL] Could not schedule source evaluation:', error.message);
            });
        }, STAGGER_DELAY_MS.SMART_SYNC_LOOP);

        // ── Phase 4: Prefetch engine (delayed) ──────────────────────
        // Non-critical – pre-caches article content for faster reads.
        setTimeout(() => {
            gcAndLogMemory('Pre-Prefetch');
            console.log('[STAGGERED BOOT] Phase 4: Starting prefetch engine...');
            runUniversalTabPrefetch(env);
        }, STAGGER_DELAY_MS.PREFETCH);
        const prefetchTimer = setInterval(() => runUniversalTabPrefetch(env), 30 * 60 * 1000);
        if (prefetchTimer.unref) prefetchTimer.unref();

        // Every run re-scans every current page; old page caches are never a completion signal.
        cron.schedule('* * * * *', async () => {
            try {
                await boardCache.tick();
            } catch (error) { console.warn('[BOARD CACHE]', error.message); }
        });

        console.log(`[STAGGERED BOOT] Startup schedule: SmartNews=${STAGGER_DELAY_MS.SMART_NEWS/1000}s, SmartSync=${STAGGER_DELAY_MS.SMART_SYNC_LOOP/1000}s, Prefetch=${STAGGER_DELAY_MS.PREFETCH/1000}s`);
    }

    return {
        startBackgroundServices
    };
}
