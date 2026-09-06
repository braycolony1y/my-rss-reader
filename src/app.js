import { isMainThread } from 'node:worker_threads';
import { createSmartNewsEngine } from '../smart-news.js';
import { fastParseRSS } from '../feed-parsers.js';
import { geminiKeyManager } from '../summary-engine.js';
import { loadConfiguration } from './config.js';
import { installProcessHandlers } from './process-lifecycle.js';
import { createHttpApp } from './http.js';
import { createDatabaseStore } from './database/store.js';
import { captureOperationalLogs } from './observability/logs.js';
import { createParserWorker } from './feeds/parser-worker.js';
import { createArticleProgress } from './articles/progress.js';
import { createArticleCache } from './articles/cache.js';
import { createAiSettings } from './ai/settings.js';
import { createGoogleNewsResolver } from './articles/google-news.js';
import { createArticleFetchPolicy } from './articles/fetch-policy.js';
import { createArticleReaders } from './articles/readers.js';
import { createArticleImages } from './articles/images.js';
import { createArticleParser } from './articles/parser.js';
import { createArticlePipeline } from './articles/pipeline.js';
import { createArticlePresentation } from './articles/presentation.js';
import { createArticleArchives } from './articles/archives.js';
import { createArticlePrefetch } from './feeds/prefetch.js';
import { createFeedSync } from './feeds/sync.js';
import { createBackgroundStartup } from './jobs/startup.js';
import { registerDiagnosticRoutes } from './routes/diagnostic-routes.js';
import { registerContentFilterRoutes } from './routes/content-filter-routes.js';
import { registerSmartRoutes } from './routes/smart-routes.js';
import { registerDataRoutes } from './routes/data-routes.js';
import { registerFeedRoutes } from './routes/feed-routes.js';
import { registerAiRoutes } from './routes/ai-routes.js';
import { registerArticleRoutes } from './routes/article-routes.js';
import { registerSettingsRoutes } from './routes/settings-routes.js';
import { registerSummaryRoutes } from './routes/summary-routes.js';
import { registerMediaRoutes } from './routes/media-routes.js';
import { registerPageRoutes } from './routes/page-routes.js';

// Construct one owner per subsystem. Deferred callbacks below connect the
// Smart engine and feed ingestion without module cycles or duplicate state.
export async function createApplication({ isMainModule = false } = {}) {
    const config = loadConfiguration();

    const lifecycle = installProcessHandlers();

    const http = createHttpApp();

    const database = createDatabaseStore();

    await database.initializeWriterLock(!process.env.SKIP_DB_LOCK && isMainThread && isMainModule);

    const logs = captureOperationalLogs();

    const worker = createParserWorker();

    const progress = createArticleProgress();

    const cache = createArticleCache({
        env: database.env,
        _writeJsonAtomic: database._writeJsonAtomic
    });

    const ai = createAiSettings({
        execFileAsync: config.execFileAsync
    });

    const googleNews = createGoogleNewsResolver({
        env: database.env,
        BROWSER_HEADERS: config.BROWSER_HEADERS,
        execFileAsync: config.execFileAsync,
        getLastKnownCachedArticle: cache.getLastKnownCachedArticle
    });

    const smartNews = createSmartNewsEngine({
        db: database.env.RSS_DATA,
        helpers: {
            fastParseRSS,
            waitForHttpIdle: http.waitForHttpIdle,
            prefetchOpenCliOnlyArticles: (...args) => prefetch.prefetchOpenCliOnlyArticles(...args),
            resolveSmartArticleDestinations: googleNews.resolveSmartArticleDestinations
        },
        headers: config.BROWSER_HEADERS,
        geminiKeyManager
    });

    const policy = createArticleFetchPolicy({
        env: database.env,
        VIETSERVER_PROXY_BASE: config.VIETSERVER_PROXY_BASE,
        smartNews
    });

    const readers = createArticleReaders({
        VIETSERVER_PROXY_BASE: config.VIETSERVER_PROXY_BASE,
        articleReaderSessions: progress.articleReaderSessions,
        updateArticleFetchProgress: progress.updateArticleFetchProgress,
        JINA_READER_BASE: config.JINA_READER_BASE,
        BROWSER_HEADERS: config.BROWSER_HEADERS,
        CF_PROXY_BASE: config.CF_PROXY_BASE
    });

    const images = createArticleImages({
        getLastKnownCachedArticle: cache.getLastKnownCachedArticle,
        fetchWithCookies: readers.fetchWithCookies,
        fetchViaOpenCli: readers.fetchViaOpenCli,
        cacheArticleResult: cache.cacheArticleResult,
        CF_PROXY_BASE: config.CF_PROXY_BASE
    });

    const parser = createArticleParser({
        updateArticleFetchProgress: progress.updateArticleFetchProgress,
        fetchViaJina: readers.fetchViaJina,
        recordArticleFetchOutcome: policy.recordArticleFetchOutcome,
        finishArticleFetchProgress: progress.finishArticleFetchProgress,
        cacheArticleResult: cache.cacheArticleResult,
        fetchViaOpenCli: readers.fetchViaOpenCli
    });

    const pipeline = createArticlePipeline({
        fetchViaJina: readers.fetchViaJina,
        fetchViaOpenCli: readers.fetchViaOpenCli,
        fetchArticleHtmlByStrategy: readers.fetchArticleHtmlByStrategy,
        parseArticleHtmlContent: parser.parseArticleHtmlContent,
        getArticleFetchPolicy: policy.getArticleFetchPolicy
    });

    const presentation = createArticlePresentation({
        resolveGoogleNewsUrl: googleNews.resolveGoogleNewsUrl,
        getLastKnownCachedArticle: cache.getLastKnownCachedArticle,
        env: database.env
    });

    const archives = createArticleArchives({
        getCachedArticle: cache.getCachedArticle,
        getArticleFetchPolicy: policy.getArticleFetchPolicy,
        fetchParsedArticleByStrategy: pipeline.fetchParsedArticleByStrategy,
        cacheArticleResult: cache.cacheArticleResult,
        _initArticleCacheIndex: cache._initArticleCacheIndex,
        getLastKnownCachedArticle: cache.getLastKnownCachedArticle,
        markUnavailableSourceUrl: presentation.markUnavailableSourceUrl,
        cache
    });

    const prefetch = createArticlePrefetch({
        getBestImage: images.getBestImage,
        BROWSER_HEADERS: config.BROWSER_HEADERS,
        getCachedArticle: cache.getCachedArticle,
        getArticleFetchPolicy: policy.getArticleFetchPolicy,
        hasOnlyOpenCliFetchMethod: pipeline.hasOnlyOpenCliFetchMethod,
        fetchParsedArticleByStrategy: pipeline.fetchParsedArticleByStrategy,
        cacheArticleResult: cache.cacheArticleResult,
        env: database.env,
        requiresIndependentDeletionConfirmation: archives.requiresIndependentDeletionConfirmation,
        buildDeletedSourceResponse: archives.buildDeletedSourceResponse,
        waitForHttpIdle: http.waitForHttpIdle,
        progress,
        googleNews
    });

    const sync = createFeedSync({
        CF_PROXY_BASE: config.CF_PROXY_BASE,
        BROWSER_HEADERS: config.BROWSER_HEADERS,
        VIETSERVER_PROXY_BASE: config.VIETSERVER_PROXY_BASE,
        fetchViaVietserver: readers.fetchViaVietserver,
        execFileAsync: config.execFileAsync,
        recordFetch: logs.recordFetch,
        fetchWithCookies: readers.fetchWithCookies,
        runParserWorker: worker.runParserWorker,
        googleDecoder: googleNews.googleDecoder,
        fetchPdfCreationDate: images.fetchPdfCreationDate,
        hasOnlyOpenCliFetchMethod: pipeline.hasOnlyOpenCliFetchMethod,
        scheduleEagerArticleImage: images.scheduleEagerArticleImage,
        getBestImage: images.getBestImage,
        prefetchOpenCliOnlyArticles: prefetch.prefetchOpenCliOnlyArticles,
        computeUniversalPrefetchList: prefetch.computeUniversalPrefetchList,
        reconcileAllConfiguredSourceFetchMethods: policy.reconcileAllConfiguredSourceFetchMethods,
        waitForHttpIdle: http.waitForHttpIdle,
        env: database.env,
        runUniversalTabPrefetch: prefetch.runUniversalTabPrefetch,
        gcAndLogMemory: http.gcAndLogMemory
    });

    const startup = createBackgroundStartup({
        reconcileAllConfiguredSourceFetchMethods: policy.reconcileAllConfiguredSourceFetchMethods,
        cleanupArticleCache: cache.cleanupArticleCache,
        env: database.env,
        normalizeClusteringModel: config.normalizeClusteringModel,
        startSequentialSyncLoop: sync.startSequentialSyncLoop,
        gcAndLogMemory: http.gcAndLogMemory,
        smartNews,
        waitForHttpIdle: http.waitForHttpIdle,
        prefetchOpenCliOnlyArticles: prefetch.prefetchOpenCliOnlyArticles,
        resolveSmartArticleDestinations: googleNews.resolveSmartArticleDestinations,
        BROWSER_HEADERS: config.BROWSER_HEADERS,
        runUniversalTabPrefetch: prefetch.runUniversalTabPrefetch,
        deletedVozThreads: archives.deletedVozThreads,
        getCachedArticle: cache.getCachedArticle,
        enqueueVozCacheBoardCrawl: archives.enqueueVozCacheBoardCrawl,
        triggerVozCurrentPageBackgroundUpdate: archives.triggerVozCurrentPageBackgroundUpdate,
        VOZ_CACHE_BOARD_REFRESH_INTERVAL_MS: archives.VOZ_CACHE_BOARD_REFRESH_INTERVAL_MS,
        http
    });

    registerDiagnosticRoutes({
        app: http.app,
        processStartTime: lifecycle.processStartTime,
        fetchHistory: logs.fetchHistory,
        env: database.env,
        manualSyncProgress: sync.manualSyncProgress,
        pruneOldEntries: logs.pruneOldEntries,
        systemLogs: logs.systemLogs,
        sync
    });

    registerContentFilterRoutes({
        app: http.app,
        env: database.env
    });

    registerSmartRoutes({
        app: http.app,
        reconcileAllConfiguredSourceFetchMethods: policy.reconcileAllConfiguredSourceFetchMethods,
        smartNews,
        synchronizeConfiguredSourceFetchMethods: policy.synchronizeConfiguredSourceFetchMethods,
        setManualSyncProgress: sync.setManualSyncProgress,
        finishManualSyncProgress: sync.finishManualSyncProgress
    });

    registerDataRoutes({
        app: http.app,
        serveSmartData: presentation.serveSmartData,
        env: database.env,
        prepareArticleForClient: presentation.prepareArticleForClient,
        presentation
    });

    registerFeedRoutes({
        app: http.app,
        setManualSyncProgress: sync.setManualSyncProgress,
        syncFeeds: sync.syncFeeds,
        env: database.env,
        smartNews,
        finishManualSyncProgress: sync.finishManualSyncProgress,
        getRootDomain: policy.getRootDomain,
        ARTICLE_FETCH_BASE_POINTS: policy.ARTICLE_FETCH_BASE_POINTS,
        normalizeConfiguredSourceFetchMethods: policy.normalizeConfiguredSourceFetchMethods,
        synchronizeConfiguredSourceFetchMethods: policy.synchronizeConfiguredSourceFetchMethods
    });

    registerAiRoutes({
        app: http.app,
        smartNews,
        env: database.env,
        readOnlineAiUsageWindow: ai.readOnlineAiUsageWindow,
        validateGeminiKey: ai.validateGeminiKey,
        persistAndActivateGeminiKey: ai.persistAndActivateGeminiKey
    });

    registerArticleRoutes({
        app: http.app,
        getArticleFetchPolicy: policy.getArticleFetchPolicy,
        fetchArticleHtmlByStrategy: readers.fetchArticleHtmlByStrategy,
        articleReaderSessions: progress.articleReaderSessions,
        articleFetchProgress: progress.articleFetchProgress,
        ARTICLE_FETCH_BASE_POINTS: policy.ARTICLE_FETCH_BASE_POINTS,
        resolveGoogleNewsUrl: googleNews.resolveGoogleNewsUrl,
        setArticleFetchPreference: policy.setArticleFetchPreference,
        rankArticleFetchStrategies: policy.rankArticleFetchStrategies,
        isProtectedDeletedSourceSnapshot: archives.isProtectedDeletedSourceSnapshot,
        deleteCachedArticle: cache.deleteCachedArticle,
        ARTICLE_CACHE_DIR: cache.ARTICLE_CACHE_DIR,
        updateArticleFetchProgress: progress.updateArticleFetchProgress,
        getLastKnownCachedArticle: cache.getLastKnownCachedArticle,
        clearUnavailableSourceUrl: presentation.clearUnavailableSourceUrl,
        finishArticleFetchProgress: progress.finishArticleFetchProgress,
        buildDeletedSourceResponse: archives.buildDeletedSourceResponse,
        getCachedArticle: cache.getCachedArticle,
        shouldRevalidateUnderfilledVozPage: archives.shouldRevalidateUnderfilledVozPage,
        getArticleFetchPreferences: policy.getArticleFetchPreferences,
        cacheArticleResult: cache.cacheArticleResult,
        deletedVozThreads: archives.deletedVozThreads,
        DELETED_SOURCE_TOMBSTONE: archives.DELETED_SOURCE_TOMBSTONE,
        triggerVozNextPagePrefetch: archives.triggerVozNextPagePrefetch,
        triggerVozCurrentPageBackgroundUpdate: archives.triggerVozCurrentPageBackgroundUpdate,
        triggerNextFiveArticlesPrefetch: prefetch.triggerNextFiveArticlesPrefetch,
        recordArticleFetchOutcome: policy.recordArticleFetchOutcome,
        requiresIndependentDeletionConfirmation: archives.requiresIndependentDeletionConfirmation,
        fetchViaJina: readers.fetchViaJina,
        expandArticleResultForSource: pipeline.expandArticleResultForSource,
        fetchViaOpenCli: readers.fetchViaOpenCli,
        parseArticleHtmlContent: parser.parseArticleHtmlContent,
        cache,
        progress,
        googleNews
    });

    registerSettingsRoutes({
        app: http.app,
        env: database.env,
        normalizeClusteringModel: config.normalizeClusteringModel,
        VALID_CLUSTERING_MODELS: config.VALID_CLUSTERING_MODELS
    });

    registerSummaryRoutes({
        app: http.app,
        decodeGoogleNews: googleNews.decodeGoogleNews,
        BROWSER_HEADERS: config.BROWSER_HEADERS,
        fetchViaVietserver: readers.fetchViaVietserver,
        env: database.env
    });

    registerMediaRoutes({
        app: http.app,
        CF_PROXY_BASE: config.CF_PROXY_BASE,
        BROWSER_HEADERS: config.BROWSER_HEADERS,
        getBestImage: images.getBestImage
    });

    registerPageRoutes({
        app: http.app
    });

    return {
        app: http.app,
        port: config.PORT,
        startBackgroundServices: startup.startBackgroundServices,
        database, cache, worker, policy, readers, parser, pipeline, archives,
        prefetch, sync, smartNews, progress, googleNews, presentation
    };
}
