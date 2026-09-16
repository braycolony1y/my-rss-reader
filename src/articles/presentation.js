import { createTopStoriesSnapshots } from './top-stories-snapshot.js';
import { createTopStoriesIndex } from './top-stories.js';
import { rankStory, storyMembers } from './story-ranking.js';
import { createStoryBriefings } from './story-briefing.js';
import { generateStoryBriefing } from '../../summary-engine.js';
import { normalizeArticleTitle } from '../../feed-parsers.js';
import { normalizeArticleSourceUrl } from '../article-source-state.js';
import { isGoogleNewsArticleUrl, isGoogleNewsHostedThumbnail } from './search-destination.js';
import { publisherIcon, safeHttpUrl, isInvalidImage, normalizeStateUrl, mapWithConcurrency, NormalizedSet } from '../utils/article-utils.js';
import { enhanceArticleResultForSource } from './source-results.js';
import sourceRegistry from '../sources/index.js';
import { cleanStoredCluster, calculateHotness, buildCluster } from '../../smart-news.js';
import { normalizeBlockedKeywordEntries, articleContentFilterMatches } from '../filters/content-filter.js';

export function createArticlePresentation({
    resolveGoogleNewsUrl,
    getLastKnownCachedArticle,
    getLastKnownCachedArticleImage = async url => (await getLastKnownCachedArticle(url))?.image,
    env,
    generateBriefing = generateStoryBriefing,
    topStoriesConfig = {},
} = {}) {
    // Cache for parsed JSON strings (e.g. smartClusters) to avoid CPU-heavy parsing on tab clicks
    let _smartClustersHistory = {};

    async function prepareArticleForClient(article, isSubItem = false) {
        const prepared = { ...article, title: normalizeArticleTitle(article.title) };
        prepared.link = normalizeArticleSourceUrl(prepared.link);
        if (prepared.originalLink) prepared.originalLink = normalizeArticleSourceUrl(prepared.originalLink);
        const cameFromGoogleNews = isGoogleNewsArticleUrl(prepared.link)
            || isGoogleNewsArticleUrl(prepared.originalLink);
        if (isGoogleNewsArticleUrl(prepared.link)) {
            prepared.originalLink = prepared.link;
            prepared.link = await resolveGoogleNewsUrl(prepared.link, prepared, { backgroundResolve: true, isSubItem });
            if (!isGoogleNewsArticleUrl(prepared.link)) prepared.feedIcon = publisherIcon(prepared.link);
        }
        if (safeHttpUrl(prepared.link) && (!prepared.feedIcon || /icons\.duckduckgo\.com\/ip3\//i.test(prepared.feedIcon))) {
            prepared.feedIcon = publisherIcon(prepared.link);
        }

        // Techmeme's RSS entry points to the Techmeme discussion page, while the
        // cached expanded article knows the original publisher. Surface that
        // metadata on list cards without re-fetching anything during tab open.
        try {
            const hostname = new URL(prepared.link).hostname.replace(/^www\./, '');
            if (hostname === 'techmeme.com' && !prepared.primarySource) {
                let cached = await getLastKnownCachedArticle(prepared.link);
                if (!cached && new URL(prepared.link).hash) {
                    const unfragmented = new URL(prepared.link);
                    unfragmented.hash = '';
                    cached = await getLastKnownCachedArticle(unfragmented.href);
                }
                if (cached) cached = enhanceArticleResultForSource(prepared.link, cached, { cacheMigration: true });
                if (cached?.primarySource) {
                    prepared.primarySource = cached.primarySource;
                    prepared.primaryArticleUrl = cached.primaryArticleUrl || cached.primarySource.url || '';
                    prepared.primaryArticleFetched = cached.primaryArticleFetched === true;
                    if (safeHttpUrl(cached.image) && !isInvalidImage(cached.image)) {
                        prepared.image = cached.image;
                    } else if (safeHttpUrl(prepared.primaryArticleUrl)) {
                        prepared.image = `/api/og-image?url=${encodeURIComponent(prepared.primaryArticleUrl)}`;
                    }
                }
            }
        } catch (error) { }

        // Google News entries often omit the publisher image. Reuse the real
        // image already stored with the prefetched publisher article instead of
        // making the browser show a generated placeholder and fetching again.
        try {
            const sourceHandler = sourceRegistry.getHandler(prepared.link);
            const readerImage = /^\/api\/og-image\?/.test(prepared.image || '');
            const currentImage = readerImage ? prepared.image : safeHttpUrl(prepared.image);
            const needsCachedImage = !currentImage
                || isInvalidImage(currentImage)
                || (cameFromGoogleNews && isGoogleNewsHostedThumbnail(currentImage))
                || sourceHandler?.isInvalidFeedImage?.(currentImage) === true;
            if (needsCachedImage && /^https?:\/\/(?:www\.)?(?:voz\.vn|tinhte\.vn)\//i.test(prepared.link)) {
                prepared.image = `/api/og-image?url=${encodeURIComponent(prepared.link)}`;
            } else if (needsCachedImage && safeHttpUrl(prepared.link) && !isGoogleNewsArticleUrl(prepared.link)) {
                const cachedImage = safeHttpUrl(await getLastKnownCachedArticleImage(prepared.link));
                if (cachedImage
                    && !isInvalidImage(cachedImage)
                    && sourceHandler?.isInvalidFeedImage?.(cachedImage) !== true) {
                    prepared.image = cachedImage;
                } else {
                    prepared.image = `/api/og-image?url=${encodeURIComponent(prepared.link)}`;
                }
            }
        } catch (error) { }

        if (!prepared.originalLink) prepared.originalLink = prepared.link;
        prepared.link = normalizeStateUrl(prepared.link);

        if (Array.isArray(prepared.relatedArticles)) {
            prepared.relatedArticles = await mapWithConcurrency(prepared.relatedArticles, 4, a => prepareArticleForClient(a, true));
        }
        return prepared;
    }

    const briefings = createStoryBriefings({ db: env?.RSS_DATA, generate: generateBriefing, loadSource: getLastKnownCachedArticle });

    // SERVER TOP STORIES ANALYSIS PREWARM
    //
    // Runs independently of browser traffic:
    //   batch 1: ranks  1-10 across all six tabs
    //   batch 2: ranks 11-20
    //   ...
    //   batch 5: ranks 41-50
    //
    // Tab priority inside every batch:
    //   VN News -> VN Finance -> VN Tech
    //   -> World News -> World Finance -> World Tech
    //
    // Only ONE background story is introduced at a time. The normal briefing
    // queue still has concurrency=2, leaving room for higher-priority user
    // requests to jump ahead.

    const STORY_PREWARM_BATCH_SIZE = 10;

    // With no readers online, prepare the first 50 stories in every tab.
    // Once a reader approaches/passes that frontier, keep analysis roughly
    // 20 stories ahead of their furthest position, rounded to 10-story batches.
    const STORY_PREWARM_BASELINE_PER_TAB = 50;
    const STORY_PREWARM_USER_AHEAD = 20;
    const STORY_PREWARM_POLL_MS = 1500;
    const STORY_PREWARM_IDLE_MS = 60 * 1000;
    const STORY_PREWARM_AUDIT_MS = 10 * 60 * 1000;
    const STORY_PREWARM_JOB_TIMEOUT_MS = 20 * 60 * 1000;

    const STORY_PREWARM_TAB_ORDER = [
        'vietnam:news',
        'vietnam:finance',
        'vietnam:tech',
        'world:news',
        'world:finance',
        'world:tech'
    ];

    let storyPrewarmRunning = false;
    let storyPrewarmTimer = null;
    let storyPrewarmLastCompleteSnapshot = null;

    const storyPrewarmTargets = new Map(
        STORY_PREWARM_TAB_ORDER.map(
            key => [key, STORY_PREWARM_BASELINE_PER_TAB]
        )
    );

    const storyPrewarmTargetFor = bucket =>
        Math.max(
            STORY_PREWARM_BASELINE_PER_TAB,
            storyPrewarmTargets.get(bucket) ||
                STORY_PREWARM_BASELINE_PER_TAB
        );

    const extendStoryPrewarmForUser = articles => {
        const visible = (articles || [])
            .filter(article => article?.topStory?.rank);

        if (!visible.length) return;

        const bucket = storyPrewarmBucket(visible[0]);

        if (!bucket || !storyPrewarmTargets.has(bucket)) return;

        const furthestRank = Math.max(
            ...visible.map(article => Number(article.topStory.rank) || 0)
        );

        // Start extending before the reader reaches the baseline boundary.
        // Example: rank 40 -> target 60.
        const desired = Math.max(
            STORY_PREWARM_BASELINE_PER_TAB,
            Math.ceil(
                (furthestRank + STORY_PREWARM_USER_AHEAD) /
                    STORY_PREWARM_BATCH_SIZE
            ) * STORY_PREWARM_BATCH_SIZE
        );

        const previous = storyPrewarmTargetFor(bucket);

        if (desired <= previous) return;

        storyPrewarmTargets.set(bucket, desired);

        console.log(
            '[STORY PREWARM] User frontier extended',
            JSON.stringify({
                bucket,
                furthestRank,
                previous,
                target: desired
            })
        );

        // If the idle pass already finished, wake it immediately rather than
        // waiting for the periodic audit.
        if (!storyPrewarmRunning) {
            if (storyPrewarmTimer) {
                clearTimeout(storyPrewarmTimer);
                storyPrewarmTimer = null;
            }

            const timer = setTimeout(
                () => void runStoryBriefingPrewarm(),
                25
            );

            timer.unref?.();
        }
    };

    const storyPrewarmSleep = ms =>
        new Promise(resolve => {
            const timer = setTimeout(resolve, ms);
            timer.unref?.();
        });

    const storyPrewarmSnapshotKey = snapshot =>
        String(
            snapshot?.signature ||
            snapshot?.createdAt ||
            snapshot?.progressiveRevision ||
            ''
        );

    const storyPrewarmBucket = article => {
        const top = article?.topStory || {};

        const context = [
            top.feed,
            top.region,
            article?.region,
            article?.smartRegion
        ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();

        if (!context) return null;

        const vietnam =
            /vietnam|viet[\s_-]*nam|việt[\s_-]*nam|(?:^|[^a-z])vn(?:[^a-z]|$)/i
                .test(context);

        let section = null;

        // Check specific verticals before generic "news".
        if (/finance|financial|business/.test(context)) {
            section = 'finance';
        }
        else if (/tech|technology/.test(context)) {
            section = 'tech';
        }
        else if (/news/.test(context)) {
            section = 'news';
        }

        if (!section) return null;

        return `${vietnam ? 'vietnam' : 'world'}:${section}`;
    };

    const storyPrewarmOne = async article => {
        const tab = article?.topStory?.feed;

        if (!tab) {
            return {
                outcome: 'skipped',
                state: null
            };
        }

        let state = await briefings.get(
            article,
            tab,
            {
                priority: 0
            }
        );

        if (
            state?.status === 'ready' ||
            state?.generationState === 'cache-hit'
        ) {
            return {
                outcome: 'cached',
                state
            };
        }

        if (state?.status === 'source-only') {
            return {
                outcome: 'source-only',
                state
            };
        }

        if (
            state?.status === 'unavailable' ||
            state?.generationState === 'failed'
        ) {
            return {
                outcome: 'failed',
                state
            };
        }

        const deadline =
            Date.now() + STORY_PREWARM_JOB_TIMEOUT_MS;

        // Do not enqueue the next background story until this one settles.
        // briefings.get() deduplicates this same key while we poll.
        while (Date.now() < deadline) {
            await storyPrewarmSleep(STORY_PREWARM_POLL_MS);

            state = await briefings.get(
                article,
                tab,
                {
                    priority: 0
                }
            );

            if (
                state?.status === 'ready' ||
                state?.generationState === 'cache-hit'
            ) {
                return {
                    outcome: 'generated',
                    state
                };
            }

            if (state?.status === 'source-only') {
                return {
                    outcome: 'source-only',
                    state
                };
            }

            if (
                state?.status === 'unavailable' ||
                state?.generationState === 'failed'
            ) {
                return {
                    outcome: 'failed',
                    state
                };
            }
        }

        return {
            outcome: 'timeout',
            state
        };
    };

    const runStoryBriefingPrewarm = async () => {
        if (storyPrewarmRunning) return;

        const db = env?.RSS_DATA;

        if (!db?.get) return;

        storyPrewarmRunning = true;

        let nextDelay = STORY_PREWARM_IDLE_MS;

        try {
            const snapshot = await db.get(
                'topStoriesPublished',
                {
                    type: 'json',
                    shared: true
                }
            );

            if (!Array.isArray(snapshot?.articles) || !snapshot.articles.length) {
                return;
            }

            const snapshotKey = storyPrewarmSnapshotKey(snapshot);

            const groups = new Map(
                STORY_PREWARM_TAB_ORDER.map(key => [key, []])
            );

            const unclassifiedFeeds = new Set();

            for (const article of snapshot.articles) {
                const bucket = storyPrewarmBucket(article);

                if (!bucket || !groups.has(bucket)) {
                    if (article?.topStory?.feed) {
                        unclassifiedFeeds.add(article.topStory.feed);
                    }
                    continue;
                }

                groups.get(bucket).push(article);
            }

            for (const stories of groups.values()) {
                stories.sort(
                    (a, b) =>
                        (Number(a?.topStory?.rank) || Number.MAX_SAFE_INTEGER) -
                        (Number(b?.topStory?.rank) || Number.MAX_SAFE_INTEGER)
                );

            }

            if (unclassifiedFeeds.size) {
                console.warn(
                    '[STORY PREWARM] Unclassified feeds:',
                    [...unclassifiedFeeds].join(', ')
                );
            }

            console.log(
                '[STORY PREWARM] Start',
                JSON.stringify({
                    snapshot: snapshotKey,
                    order: STORY_PREWARM_TAB_ORDER,
                    batchSize: STORY_PREWARM_BATCH_SIZE,
                    baselinePerTab: STORY_PREWARM_BASELINE_PER_TAB,
                    targets: Object.fromEntries(storyPrewarmTargets),
                    counts: Object.fromEntries(
                        [...groups.entries()].map(
                            ([key, stories]) => [key, stories.length]
                        )
                    )
                })
            );

            for (
                let offset = 0;
                offset < Math.max(
                    ...STORY_PREWARM_TAB_ORDER.map(
                        storyPrewarmTargetFor
                    )
                );
                offset += STORY_PREWARM_BATCH_SIZE
            ) {
                for (const bucket of STORY_PREWARM_TAB_ORDER) {
                    const target = storyPrewarmTargetFor(bucket);

                    if (offset >= target) continue;
                    // Before each tab batch, ensure we are still preparing the
                    // current published Top Stories snapshot.
                    const latest = await db.get(
                        'topStoriesPublished',
                        {
                            type: 'json',
                            shared: true
                        }
                    );

                    if (
                        storyPrewarmSnapshotKey(latest) !== snapshotKey
                    ) {
                        console.log(
                            '[STORY PREWARM] Snapshot changed; restarting with newest snapshot'
                        );

                        return;
                    }

                    const stories =
                        groups
                            .get(bucket)
                            .slice(
                                offset,
                                Math.min(
                                    offset + STORY_PREWARM_BATCH_SIZE,
                                    target
                                )
                            );

                    if (!stories.length) continue;

                    const stats = {
                        cached: 0,
                        generated: 0,
                        sourceOnly: 0,
                        skipped: 0,
                        failed: 0
                    };

                    console.log(
                        `[STORY PREWARM] ${bucket} ranks ${offset + 1}-${offset + stories.length}`
                    );

                    for (const article of stories) {
                        const result =
                            await storyPrewarmOne(article);

                        if (result.outcome === 'cached') {
                            stats.cached++;
                        }
                        else if (result.outcome === 'generated') {
                            stats.generated++;
                        }
                        else if (result.outcome === 'source-only') {
                            stats.sourceOnly++;
                        }
                        else if (result.outcome === 'skipped') {
                            stats.skipped++;
                        }
                        else {
                            stats.failed++;

                            console.warn(
                                '[STORY PREWARM] Deferred failed story',
                                JSON.stringify({
                                    bucket,
                                    rank: article?.topStory?.rank,
                                    clusterId: article?.clusterId,
                                    outcome: result.outcome,
                                    error:
                                        result.state?.generationError ||
                                        null
                                })
                            );

                            // Do not let one malformed/provider-failed story
                            // block every later story and every later tab.
                            // story-briefing.js already records its retry time;
                            // a later audit will reconsider it.
                            continue;
                        }
                    }

                    console.log(
                        '[STORY PREWARM] Batch complete',
                        JSON.stringify({
                            bucket,
                            from: offset + 1,
                            to: offset + stories.length,
                            ...stats
                        })
                    );
                }
            }

            storyPrewarmLastCompleteSnapshot = snapshotKey;
            nextDelay = STORY_PREWARM_AUDIT_MS;

            console.log(
                '[STORY PREWARM] First 50 complete for all available tabs',
                snapshotKey
            );
        }
        catch (error) {
            console.warn(
                '[STORY PREWARM] Error:',
                error?.message || error
            );
        }
        finally {
            storyPrewarmRunning = false;

            // Even after a completed pass, periodically audit the first 50.
            // Valid cached analyses return immediately and consume no AI.
            storyPrewarmTimer = setTimeout(
                () => {
                    storyPrewarmTimer = null;
                    void runStoryBriefingPrewarm();
                },
                nextDelay
            );

            storyPrewarmTimer.unref?.();
        }
    };

    // Start shortly after the server initializes. This does not depend on an
    // HTTP request, so analyses continue preparing with zero users online.
    if (env?.RSS_DATA?.get) {
        storyPrewarmTimer = setTimeout(
            () => {
                storyPrewarmTimer = null;
                void runStoryBriefingPrewarm();
            },
            5000
        );

        storyPrewarmTimer.unref?.();
    }
    const topIndex = createTopStoriesIndex({ db: env?.RSS_DATA, config: topStoriesConfig });
    const smartApiViewCache = new Map();
    const storyViews = new Map();
    const filteredTopViews = new Map();
    let storyViewSequence = 0;

    let latestSmartApiVersion = '';
    let latestTopSnapshotSignature = '';
    const freshViewCache = new Map();
    const topSnapshots = createTopStoriesSnapshots({ db: env?.RSS_DATA, config: topIndex.settings });

    let unavailableSourceMutation = Promise.resolve();

    function markUnavailableSourceUrl(url) {
        const normalizedUrl = normalizeStateUrl(url);
        if (!normalizedUrl) return Promise.resolve();
        unavailableSourceMutation = unavailableSourceMutation.catch(() => {}).then(async () => {
            const urls = await env.RSS_DATA.get('unavailableSourceUrls', { type: 'json' }) || [];
            const unavailable = new NormalizedSet(urls);
            if (unavailable.has(normalizedUrl)) return;
            urls.push(normalizedUrl);
            await env.RSS_DATA.put('unavailableSourceUrls', JSON.stringify(urls));
            smartApiViewCache.clear();
        });
        return unavailableSourceMutation;
    }

    function clearUnavailableSourceUrl(url) {
        const normalizedUrl = normalizeStateUrl(url);
        if (!normalizedUrl) return Promise.resolve();
        unavailableSourceMutation = unavailableSourceMutation.catch(() => {}).then(async () => {
            const urls = await env.RSS_DATA.get('unavailableSourceUrls', { type: 'json' }) || [];
            const nextUrls = urls.filter(value => normalizeStateUrl(value) !== normalizedUrl);
            if (nextUrls.length === urls.length) return;
            await env.RSS_DATA.put('unavailableSourceUrls', JSON.stringify(nextUrls));
            smartApiViewCache.clear();
        });
        return unavailableSourceMutation;
    }

    function isInvestingSmartArticle(article) {
        if (!article) return false;
        const text = [
            article.link,
            article.feedUrl,
            article.url,
            article.feedTitle,
            article.sourceName,
            article.source,
            ...(Array.isArray(article.sources) ? article.sources : [])
        ].filter(Boolean).join(' ').toLowerCase();
        return text.includes('investing.com');
    }

    function smartTechRegion(article) {
        const region = String(article?.region || '').toLowerCase();

        if (region === 'vietnam') return 'vietnam';
        if (['foreign', 'world', 'global'].includes(region)) return 'world';

        // Older stored records may not have region populated.
        return /^vi(?:-|$)/i.test(String(article?.language || ''))
            ? 'vietnam'
            : 'world';
    }

    function smartArticleMatchesSection(
        article,
        filterValue,
        smartRegion = 'world'
    ) {
        if (!filterValue) return true;

        if (filterValue === 'news') {
            return ['news_vietnam', 'news_world']
                .includes(article.smartCategory);
        }

        if (filterValue === 'finance') {
            return ['finance_vietnam', 'finance_global']
                .includes(article.smartCategory);
        }

        if (filterValue === 'tech') {
            return (
                article.smartCategory === 'tech' &&
                !isInvestingSmartArticle(article) &&
                smartTechRegion(article) === smartRegion
            );
        }

        return article.smartCategory === filterValue;
    }

    function buildSmartApiView(
        rawClusters,
        filterValue,
        smartRegion = 'world'
    ) {
        const clusters = [];
        for (const storedArticle of rawClusters) {
            const cleaned = cleanStoredCluster((storedArticle.isCluster || storedArticle.clusterId) ? { ...storedArticle, isCluster: true } : buildCluster([storedArticle]));
            if (
                !cleaned ||
                !smartArticleMatchesSection(
                    cleaned,
                    filterValue,
                    smartRegion
                )
            ) continue;

            let article = cleaned;
            if (filterValue === 'tech' && Array.isArray(cleaned.relatedArticles)) {
                const cleanRelated = cleaned.relatedArticles.filter(
                    related =>
                        smartArticleMatchesSection(
                            related,
                            'tech',
                            smartRegion
                        )
                );
                if (cleanRelated.length !== cleaned.relatedArticles.length) {
                    const sources = [...new Set([cleaned.feedTitle, ...cleanRelated.map(related => related.feedTitle)].filter(Boolean))];
                    article = {
                        ...cleaned,
                        relatedArticles: cleanRelated,
                        clusterCount: cleanRelated.length + 1,
                        sourceCount: sources.length,
                        sources
                    };
                }
            }

            const clusterArticles = [article, ...(Array.isArray(article.relatedArticles) ? article.relatedArticles : [])];
            const ranking = rankStory(clusterArticles, filterValue);
            clusters.push({ ...article, hotness: ranking.score, sourceCount: ranking.independentSources, ranking });
        }

        clusters.sort((left, right) =>
            (right.hotness || 0) - (left.hotness || 0) ||
            (right.sourceWeight || 1) - (left.sourceWeight || 1) ||
            (new Date(right.pubDate || 0).getTime()) - (new Date(left.pubDate || 0).getTime())
        );
        return clusters;
    }

    function markUnavailableSmartSources(article, unavailableSet) {
        const annotate = candidate => unavailableSet.has(candidate?.link)
            ? { ...candidate, sourceDeleted: true, sourceDeletedHasCache: false }
            : candidate;
        return {
            ...annotate(article),
            ...(Array.isArray(article.relatedArticles)
                ? { relatedArticles: article.relatedArticles.map(annotate) }
                : {})
        };
    }

    async function serveSmartData(req, res) {
        const startedAt = Date.now();
        const timings = Object.fromEntries(['rank-state-read','cluster-reconciliation','relevance-computation','signal-computation','sorting-ranking','top-cutoff','rank-persistence'].map(name=>[name,0])); let phaseAt = performance.now();
        const mark = name => { const t = performance.now(); timings[name] = t-phaseAt; phaseAt=t; };
        mark("request-received");
        const filterValue = req.query.filterValue || '';
        const smartRegion =
            req.query.smartRegion === 'vietnam'
                ? 'vietnam'
                : 'world';
        const smartRegionKey =
            filterValue === 'tech' ? smartRegion : '';
        const hideRead = req.query.hideRead === 'true';
        const searchQuery = req.query.searchQuery ? req.query.searchQuery.toLowerCase() : '';

        const [
            feeds,
            readStates,
            savedStates,
            boardStates,
            hiddenStates,
            categoryOrder,
            userPreferences,
            blockedKeywords,
            unavailableSourceUrls
        ] = await Promise.all([
            env.RSS_DATA.get('feeds', { type: 'json' }),
            env.RSS_DATA.get('readStates', { type: 'json' }),
            env.RSS_DATA.get('savedStates', { type: 'json' }),
            env.RSS_DATA.get('boardStates', { type: 'json' }),
            env.RSS_DATA.get('hiddenStates', { type: 'json' }),
            env.RSS_DATA.get('categoryOrder', { type: 'json' }),
            env.RSS_DATA.get('userPreferences', { type: 'json' }),
            env.RSS_DATA.get('blockedArticleKeywords', { type: 'json' }),
            env.RSS_DATA.get('unavailableSourceUrls', { type: 'json' })
        ]);

        const storedSmartMode =
            userPreferences?.smartTabModes?.__all ||
            userPreferences?.smartTabModes?.[filterValue];

        const smartTabMode =
            ['top', 'classic'].includes(req.query.smartMode)
                ? req.query.smartMode
                : (storedSmartMode === 'classic' ? 'classic' : 'top');
        const isTop = smartTabMode === 'top' && Boolean(filterValue);

        // Expired pinned views otherwise remain in memory indefinitely until
        // enough new view tokens happen to evict them.
        const viewNow = Date.now();
        for (const [key, view] of storyViews) {
            if (
                !view?.createdAt ||
                viewNow - view.createdAt >= 30 * 60000
            ) {
                storyViews.delete(key);
            }
        }

        let smartClusterVersion = '', filteredArticles, publishedArticles, cacheHit = false;
        if (isTop) {
            const snapshot = await topSnapshots.get();
            mark('persisted-read');
            cacheHit = Boolean(snapshot);

            // Never let filtered Top views pin a previous full published
            // snapshot after Top Stories has produced a replacement.
            const topSnapshotSignature = String(
                snapshot?.signature ||
                snapshot?.clusterVersion ||
                ''
            );
            if (
                topSnapshotSignature &&
                topSnapshotSignature !== latestTopSnapshotSignature
            ) {
                filteredTopViews.clear();
                latestTopSnapshotSignature = topSnapshotSignature;
            }

            publishedArticles = snapshot?.articles;
            smartClusterVersion = snapshot?.clusterVersion || '';
            const destination =
                filterValue === 'tech'
                    ? `tech_${smartRegion}`
                    : filterValue.replace('_global', '_world');
            filteredArticles = (snapshot?.articles || []).filter(a => a.topStory.feed === destination || (['news','finance'].includes(filterValue) && a.topStory.feed.startsWith(filterValue + '_')));
            mark('candidate-collection');
            // Start only after the response is handed to the transport.
            if (res.once) res.once('finish', () => topSnapshots.schedule());
            else topSnapshots.schedule();
        } else {
            const requestedVersion = !isTop && Number(req.query.page || 1) > 1 ? (req.query.smartVersion || '') : '';
            let rawClusters;
            if (requestedVersion && _smartClustersHistory[requestedVersion]) {
                rawClusters = _smartClustersHistory[requestedVersion];
                smartClusterVersion = requestedVersion;
            } else {
                const [finalVersion, progressiveState] = await Promise.all([
                    env.RSS_DATA.get('smartClusterVersion'),
                    requestedVersion ? Promise.resolve(null) : env.RSS_DATA.get('smartProgressiveClusterState', { type: 'json' })
                ]);
                const progressiveVersion = String(progressiveState?.version || '');
                let progressiveActive = Boolean(
                    !requestedVersion &&
                    progressiveState?.active === true &&
                    progressiveState?.provisional === true &&
                    progressiveVersion
                );
                if (progressiveActive) {
                    const publication = await env.RSS_DATA.get('smartProgressivePublication', { type: 'json', shared: true });
                    if (
                        publication?.version === progressiveVersion &&
                        Array.isArray(publication?.clusters)
                    ) {
                        rawClusters = publication.clusters;
                    } else {
                        progressiveActive = false;
                    }
                }
                smartClusterVersion = requestedVersion || (progressiveActive ? progressiveVersion : (finalVersion || ''));
                if (!progressiveActive) {
                    rawClusters = await env.RSS_DATA.get('smartClusters', { type: 'json', shared: true }) || [];
                }
                if (smartClusterVersion) {
                    // Every progressive revision is a complete Smart cluster graph.
                    // Retaining several revisions can pin multiple huge object graphs
                    // in V8 old space even after Smart verification has completed.
                    for (const key of Object.keys(_smartClustersHistory)) {
                        if (
                            /_progressive_/.test(String(key)) &&
                            key !== smartClusterVersion
                        ) {
                            delete _smartClustersHistory[key];
                        }
                    }

                    _smartClustersHistory[smartClusterVersion] = rawClusters;

                    // Keep current + at most one older version for pagination.
                    const staleKeys = Object.keys(_smartClustersHistory)
                        .filter(key => key !== smartClusterVersion);

                    while (
                        Object.keys(_smartClustersHistory).length > 2 &&
                        staleKeys.length
                    ) {
                        delete _smartClustersHistory[staleKeys.shift()];
                    }
                }
            }

            if (!requestedVersion && smartClusterVersion !== latestSmartApiVersion) {
                smartApiViewCache.clear();

                // Each fresh view stores references to the complete raw article
                // and cluster graphs. Keeping entries from prior Smart versions
                // can therefore pin multiple huge object graphs.
                freshViewCache.clear();

                latestSmartApiVersion = smartClusterVersion;
            }

            mark("persisted-read");
            const cacheKey =
                `${smartClusterVersion}:${filterValue}:${smartRegionKey}:${Math.floor(Date.now() / 60000)}`;
            filteredArticles = smartApiViewCache.get(cacheKey);
            cacheHit = Boolean(filteredArticles);
            if (!filteredArticles) {
                filteredArticles = buildSmartApiView(
                    rawClusters,
                    filterValue,
                    smartRegion
                );
                smartApiViewCache.set(cacheKey, filteredArticles);
                while (smartApiViewCache.size > 7) smartApiViewCache.delete(smartApiViewCache.keys().next().value);
            }

            // Fresh headlines must remain visible while embeddings and AI grouping run.
            // Preserve grouped stories and add only articles absent from that snapshot.
            const rawArticles = await env.RSS_DATA.get('smartRawArticles', { type: 'json', shared: true }) || [];
            const freshKey =
                `${smartClusterVersion}:${filterValue}:${smartRegionKey}:${Math.floor(Date.now() / 60000)}`;
            let freshView = freshViewCache.get(freshKey);
            if (!freshView || freshView.raw !== rawArticles || freshView.clusters !== rawClusters) {
                const represented = new NormalizedSet(rawClusters.flatMap(article =>
                    [article.link, ...(article.relatedArticles || []).map(related => related.link)]));
                const freshArticles = rawArticles.filter(article => !represented.has(article.link)
                    && smartArticleMatchesSection(
                        article,
                        filterValue,
                        smartRegion
                    ));
                const articles = [
                    ...filteredArticles,
                    ...buildSmartApiView(
                        freshArticles,
                        filterValue,
                        smartRegion
                    )
                ];
                const cutoff = Date.now() - 24 * 60 * 60 * 1000;
                const recent = article => Number(new Date(article.pubDate || 0).getTime() > cutoff);
                articles.sort((a, b) => recent(b) - recent(a) || (b.hotness || 0) - (a.hotness || 0)
                    || new Date(b.pubDate || 0) - new Date(a.pubDate || 0));
                freshView = { raw: rawArticles, clusters: rawClusters, articles };
                freshViewCache.set(freshKey, freshView);
                while (freshViewCache.size > 7) freshViewCache.delete(freshViewCache.keys().next().value);
            }
            filteredArticles = freshView.articles;
            mark("candidate-collection");
        }
        mark('ranking-total');
        const readSet = new NormalizedSet(readStates || []);
        const hiddenSet = new NormalizedSet(hiddenStates || []);
        const unavailableSet = new NormalizedSet(unavailableSourceUrls || []);
        const blockedKeywordEntries = normalizeBlockedKeywordEntries(blockedKeywords || []);
        const matchesSearch = value => String(value || '').toLowerCase().includes(searchQuery);

        const filterSignature = JSON.stringify([
            filterValue,
            smartRegionKey,
            hideRead,
            searchQuery,
            hiddenStates,
            hideRead ? readStates : [],
            blockedKeywords,
            unavailableSourceUrls
        ]);
        const cachedFiltered = isTop && filteredTopViews.get(filterSignature);
        if (
            cachedFiltered &&
            cachedFiltered.snapshotSignature === latestTopSnapshotSignature
        ) {
            filteredArticles = cachedFiltered.articles;
        }
        else {
            const needsMemberFiltering = !isTop || hiddenSet.size > 0 || blockedKeywordEntries.length > 0 || unavailableSet.size > 0;
            filteredArticles = filteredArticles
                .map(article => {
                    if (!needsMemberFiltering) return article;
                    const members = storyMembers(article).filter(a => !hiddenSet.has(a.link) && !articleContentFilterMatches(a, blockedKeywordEntries));
                    if (!members.length) return null;
                    const representative = members[0];
                    return markUnavailableSmartSources({ ...article, ...representative, isCluster: true, clusterId: article.clusterId,
                        relatedArticles: members.slice(1), clusterCount: members.length }, unavailableSet);
                })
                .filter(Boolean)
                .filter(article => {
                if (hiddenSet.has(article.link) || articleContentFilterMatches(article, blockedKeywordEntries)) return false;
                if (hideRead && storyMembers(article).every(member => readSet.has(member.link))) return false;
                if (!searchQuery) return true;
                return matchesSearch(article.title) ||
                    matchesSearch(article.feedTitle) ||
                    matchesSearch(article.content) ||
                    (Array.isArray(article.relatedArticles) && article.relatedArticles.some(related =>
                        matchesSearch(related.title) || matchesSearch(related.feedTitle)
                    ));
                });

            // In the normal Top path there is nothing to mutate. Avoid
            // shallow-copying thousands of full article/cluster objects merely
            // to recreate an identical relatedArticles array.
            if (needsMemberFiltering) {
                filteredArticles = filteredArticles.map(article => ({
                    ...article,
                    relatedArticles: (article.relatedArticles || []).filter(
                        a =>
                            !hiddenSet.has(a.link) &&
                            !articleContentFilterMatches(a, blockedKeywordEntries)
                    )
                }));
            }

            if (isTop) {
                filteredTopViews.set(filterSignature, {
                    snapshotSignature: latestTopSnapshotSignature,
                    articles: filteredArticles
                });
                while (filteredTopViews.size > 12) {
                    filteredTopViews.delete(filteredTopViews.keys().next().value);
                }
            }
        }
        // Classic retains its existing ranking. Top Stories is fully scored above.
        const ranked = isTop ? filteredArticles : (await mapWithConcurrency(filteredArticles, 8, async article => {
            const ranking = rankStory(storyMembers(article), filterValue, Date.now(), await briefings.peek(article, filterValue));
            return { ...article, ranking, hotness: ranking.score, sourceCount: ranking.independentSources };
        })).sort((a,b) => b.hotness - a.hotness || b.ranking.updatedAt.localeCompare(a.ranking.updatedAt) || a.link.localeCompare(b.link));
        mark("filtering");
        const viewSignature = JSON.stringify([
            filterValue,
            smartTabMode,
            filterValue === 'tech' ? smartRegion : null,
            hideRead,
            searchQuery,
            hiddenStates,
            hideRead ? readStates : [],
            blockedKeywords
        ]);
        const priorView = storyViews.get(req.query.smartView);
        const reusableView = priorView && priorView.signature === viewSignature && Date.now() - priorView.createdAt < 30 * 60000;
        let smartViewToken = req.query.smartView;
        filteredArticles = reusableView ? priorView.articles : ranked;
        if (!reusableView) {
            smartViewToken = `${Date.now()}-${++storyViewSequence}`;
            storyViews.set(smartViewToken, { signature: viewSignature, articles: filteredArticles, createdAt: Date.now() });
            while (storyViews.size > 8) storyViews.delete(storyViews.keys().next().value);
        }
        const viewReset = Boolean(req.query.smartView && !reusableView);
        const page = viewReset ? 1 : Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.max(1, Math.min(100, parseInt(req.query.limit) || 40));
        const startIndex = (page - 1) * limit;
        const endIndex = page * limit;
        const currentById = new Map(ranked.map(a => [a.clusterId, a]));
        const currentStory = article => isTop ? currentById.get(article.clusterId) || article : article;
        const pageArticles = filteredArticles.slice(startIndex, endIndex);

        // User scrolling can extend server prewarming beyond the idle
        // first-50 baseline. This is intentionally recorded before response
        // completion so background preparation starts while they are reading.
        if (isTop && pageArticles.length) {
            extendStoryPrewarmForUser(pageArticles);
        }

        // Briefing generation has a separate notion of the ACTIVE page.
        // Ranking order remains pinned by smartViewToken; this key identifies
        // what the reader is actually viewing right now.
        const briefingViewKey =
            isTop && filterValue
                ? [
                    smartViewToken || 'view',
                    filterValue,
                    req.query.smartRegion || '',
                    `page:${page}`
                ].join(':')
                : null;

        // null when leaving Top Stories, so the previous page
        // immediately loses its active-view priority boost.
        briefings.setActiveView(briefingViewKey);
        mark("snapshot-construction");
        const rankingPending = Boolean(isTop && topSnapshots.pending);
        if (isTop && filterValue) {
            const ahead = filteredArticles.slice(startIndex, endIndex + topIndex.settings.batchSize * topIndex.settings.lookAheadBatches);
            const enqueue = () => {
                const timer = setTimeout(async () => {
                    try {
                        for (let i = 0; i < ahead.length; i++) {
                            await briefings.get(
                                currentStory(ahead[i]),
                                ahead[i].topStory.feed,
                                {
                                    priority:
                                        i < pageArticles.length
                                            ? 2
                                            : 0,
                                    viewKey: briefingViewKey
                                }
                            );
                        }
                    }
                    catch (error) { console.warn('[TOP STORIES] Background briefing queue:', error.message); }
                }, 25);
                timer.unref?.();
            };
            if (res.once) res.once('finish', enqueue); else enqueue();
        }
        const updatesAvailable = Boolean(isTop && reusableView && JSON.stringify(ranked.map(a => [a.clusterId, a.topStory.material_version, a.topStory.isTop])) !== JSON.stringify(priorView.articles.map(a => [a.clusterId, a.topStory.material_version, a.topStory.isTop])));
        const paginatedArticles = await mapWithConcurrency(pageArticles, 6, async article => {
            const current = currentStory(article);
            // A completed story update can replace its card atomically without
            // changing the reader's pinned order or Top/More boundary.
            const display = isTop ? {...current, topStory:{...current.topStory,
                rank:article.topStory.rank,isTop:article.topStory.isTop,cutoff:article.topStory.cutoff}} : article;
            return {
                ...await prepareArticleForClient(display),
                ...(isTop ? {title:display.title,topStory:display.topStory} : {}),
                ...(filterValue ? {briefing:await briefings.get(current, isTop ? current.topStory.feed : filterValue, {generate:false,priority:2})} : {})
            };
        });
        mark('card-preparation');
        res.setHeader('Server-Timing', Object.entries(timings).map(([name,ms])=>`${name};dur=${ms.toFixed(3)}`).join(', '));
        res.setHeader('X-Smart-View-Cache', cacheHit ? 'hit' : 'miss');
        const payload = {
            feeds: feeds || [],
            articles: paginatedArticles,
            topStories: [],
            smartTabMode,
            rankingPending,
            updatesAvailable,
            smartViewToken,
            viewReset,
            readStates: readStates || [],
            savedStates: savedStates || [],
            boardStates: boardStates || [],
            hiddenStates: hiddenStates || [],
            categoryOrder: categoryOrder || [],
            userPreferences: userPreferences || {},
            hasMore: endIndex < filteredArticles.length,
            currentPage: page,
            smartClusterVersion
        };
        if (!isTop) { res.setHeader('Server-Timing', `smart-data;dur=${Date.now()-startedAt}`); return res.json(payload); }
        const serialized = JSON.stringify(payload); mark("serialization");
        res.setHeader("Server-Timing", Object.entries(timings).map(([name,ms])=>`${name};dur=${ms.toFixed(3)}`).join(", "));
        if (res.send) res.type("json").send(serialized); else res.json(payload);
        mark("response-sent");
        if (process.env.SMART_REFRESH_PROFILE) console.info("[SMART REFRESH]", JSON.stringify(timings));
    }

    return {
        markUnavailableSourceUrl,
        serveSmartData,
        get _smartClustersHistory() { return _smartClustersHistory; },
        prepareArticleForClient,
        clearUnavailableSourceUrl
    };
}
