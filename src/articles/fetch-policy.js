import { normalizeStateUrl, normalizedHostname, isRedditUrl } from '../utils/article-utils.js';
import { sourceFetchPolicyIdentity } from '../../smart-news.js';

export function createArticleFetchPolicy({
    env,
    VIETSERVER_PROXY_BASE,
    smartNews,
} = {}) {
    // --- ADAPTIVE ARTICLE FETCH STRATEGY RANKING ---
    const ARTICLE_FETCH_BASE_POINTS = {
        direct: 100,
        cloudflare: 80,
        vietserver: 70,
        allorigins: 55,
        jina: 40,
        'opencli-fetch': 25,
        opencli: 20
    };

    let articleFetchStrategyStats = null;

    let articleFetchStatsSaveTimer = null;

    async function ensureArticleFetchStats() {
        if (!articleFetchStrategyStats) {
            articleFetchStrategyStats = await env.RSS_DATA.get('articleFetchStrategyStats', { type: 'json' }) || {};
        }
        return articleFetchStrategyStats;
    }

    function scheduleArticleFetchStatsSave() {
        if (articleFetchStatsSaveTimer) return;
        articleFetchStatsSaveTimer = setTimeout(async () => {
            articleFetchStatsSaveTimer = null;
            try {
                await env.RSS_DATA.put('articleFetchStrategyStats', JSON.stringify(articleFetchStrategyStats || {}));
            } catch (error) {
                console.error('[ARTICLE FETCH] Could not persist adaptive scores:', error.message);
            }
        }, 5000);
        if (articleFetchStatsSaveTimer.unref) articleFetchStatsSaveTimer.unref();
    }

    async function rankArticleFetchStrategies(hostname) {
        const stats = await ensureArticleFetchStats();
        const sourceStats = stats[hostname] || {};
        const available = Object.keys(ARTICLE_FETCH_BASE_POINTS).filter(name => name !== 'vietserver' || Boolean(VIETSERVER_PROXY_BASE));
        const isRichDom = /(?:voz\.vn|tinhte\.vn|vnexpress\.net|tuoitre\.vn|vtv\.vn|kenh14\.vn|nhandan\.vn|thanhnien\.vn|dantri\.com\.vn|laodong\.vn|vietnamnet\.vn|soha\.vn|tienphong\.vn|znews\.vn|cafef\.vn|genk\.vn|afamily\.vn|\.vn|\.com\.vn)$/i.test(hostname);
        return available.sort((a, b) => {
            const aStats = sourceStats[a] || {};
            const bStats = sourceStats[b] || {};
            const aPenalty = ((aStats.consecutiveFailures || 0) >= 3 && !isRichDom) ? 100 : 0;
            const bPenalty = ((bStats.consecutiveFailures || 0) >= 3 && !isRichDom) ? 100 : 0;
            const aPreference = (isRichDom && a === 'jina') ? -200 : (aStats.userPreference === 1 ? 100 : (aStats.userPreference === -1 ? -120 : 0));
            const bPreference = (isRichDom && b === 'jina') ? -200 : (bStats.userPreference === 1 ? 100 : (bStats.userPreference === -1 ? -120 : 0));
            const aDomBonus = (isRichDom && ['cloudflare', 'direct', 'vietserver'].includes(a)) ? 350 : 0;
            const bDomBonus = (isRichDom && ['cloudflare', 'direct', 'vietserver'].includes(b)) ? 350 : 0;
            const aPoints = ARTICLE_FETCH_BASE_POINTS[a] + (aStats.qualityPoints || 0) + aPreference + aDomBonus - aPenalty;
            const bPoints = ARTICLE_FETCH_BASE_POINTS[b] + (bStats.qualityPoints || 0) + bPreference + bDomBonus - bPenalty;
            return bPoints - aPoints;
        });
    }

    async function getConfiguredArticleFetchMethods(targetUrl, feedUrl = '') {
        const feeds = await env.RSS_DATA.get('feeds', { type: 'json' }) || [];
        const validMethods = methods => Array.isArray(methods)
            ? [...new Set(methods.filter(method => method in ARTICLE_FETCH_BASE_POINTS))]
            : [];
        // Normal feeds take precedence over Smart sources. Page navigation
        // already supplies its feed, so avoid loading unrelated source settings.
        const exactFeed = feedUrl && feeds.find(feed => feed.url === feedUrl);
        if (exactFeed && Array.isArray(exactFeed.fetchMethods)) return validMethods(exactFeed.fetchMethods);
        let smartSources = [];
        try {
            smartSources = await smartNews.getSourceSettings();
        } catch (error) {
            console.warn('[ARTICLE FETCH] Could not load Smart source policies:', error.message);
        }
        const configuredSources = [...feeds, ...smartSources];

        const policyForSourceUrl = candidateFeedUrl => {
            if (!candidateFeedUrl) return null;
            const exactFeed = configuredSources.find(feed => feed.url === candidateFeedUrl);
            return exactFeed && Array.isArray(exactFeed.fetchMethods)
                ? validMethods(exactFeed.fetchMethods)
                : null;
        };

        if (feedUrl) {
            const exactPolicy = policyForSourceUrl(feedUrl);
            if (exactPolicy !== null) return exactPolicy;
        }

        // Requests created by saved boards or older clients may not carry the
        // feed URL. Recover the source identity from the current article record
        // before considering any host-level inference.
        try {
            const articles = await env.RSS_DATA.get('articles', { type: 'json', shared: true }) || [];
            const targetIdentity = normalizeStateUrl(targetUrl);
            const associatedFeedUrls = [...new Set(articles
                .filter(article => [article?.link, article?.originalLink, article?.id]
                    .some(candidate => normalizeStateUrl(candidate) === targetIdentity))
                .map(article => article?.feedUrl)
                .filter(Boolean))];
            if (associatedFeedUrls.length) {
                const associatedPolicies = associatedFeedUrls
                    .map(policyForSourceUrl)
                    .filter(policy => policy !== null);
                if (associatedPolicies.length === associatedFeedUrls.length) {
                    const signature = JSON.stringify(associatedPolicies[0]);
                    if (associatedPolicies.every(policy => JSON.stringify(policy) === signature)) {
                        return associatedPolicies[0];
                    }
                }
            }
        } catch (error) {
            console.warn('[ARTICLE FETCH] Could not resolve source policy from article metadata:', error.message);
        }

        // Background jobs and board warmups do not carry feedUrl. If every feed
        // on the same host has the same explicit policy, safely apply that policy
        // to the article instead of falling back to the global adaptive list.
        const targetHost = normalizedHostname(targetUrl);
        if (!targetHost) return null;
        const hostFeeds = configuredSources.filter(feed => normalizedHostname(feed.url) === targetHost);
        if (!hostFeeds.length || hostFeeds.some(feed => !Array.isArray(feed.fetchMethods) || !feed.fetchMethods.length)) return null;
        const hostPolicies = hostFeeds.map(feed => validMethods(feed.fetchMethods));
        if (hostPolicies.some(methods => !methods.length)) return null;
        const signature = JSON.stringify(hostPolicies[0]);
        return hostPolicies.every(methods => JSON.stringify(methods) === signature)
            ? hostPolicies[0]
            : null;
    }

    async function getArticleFetchPolicy(targetUrl, feedUrl = '') {
        const hostname = normalizedHostname(targetUrl);
        if (isRedditUrl(targetUrl)) return {
            hostname, openExternally: true, allAvailableStrategies: [], availableStrategies: [],
            configuredMethods: [], hasStrictConfiguredMethods: true, strategyOrder: [],
            excludedStrategies: new Set(Object.keys(ARTICLE_FETCH_BASE_POINTS))
        };
        const allAvailableStrategies = Object.keys(ARTICLE_FETCH_BASE_POINTS)
            .filter(name => name !== 'vietserver' || Boolean(VIETSERVER_PROXY_BASE));
        const configuredMethods = await getConfiguredArticleFetchMethods(targetUrl, feedUrl);
        const hasStrictConfiguredMethods = Array.isArray(configuredMethods) && configuredMethods.length > 0;
        const configuredAvailableStrategies = hasStrictConfiguredMethods
            ? configuredMethods.filter(method => allAvailableStrategies.includes(method))
            : [];
        const strategyOrder = hasStrictConfiguredMethods
            ? configuredAvailableStrategies
            : await rankArticleFetchStrategies(hostname);
        const availableStrategies = hasStrictConfiguredMethods
            ? configuredAvailableStrategies
            : allAvailableStrategies;
        return {
            hostname,
            allAvailableStrategies,
            availableStrategies,
            configuredMethods,
            hasStrictConfiguredMethods,
            strategyOrder,
            excludedStrategies: new Set(
                allAvailableStrategies.filter(method => hasStrictConfiguredMethods && !configuredAvailableStrategies.includes(method))
            )
        };
    }

    async function getArticleFetchPreferences(hostname) {
        const stats = await ensureArticleFetchStats();
        const sourceStats = stats[hostname] || {};
        return Object.fromEntries(Object.keys(ARTICLE_FETCH_BASE_POINTS).map(strategy => [
            strategy,
            sourceStats[strategy]?.userPreference === 1 ? 'like' : (sourceStats[strategy]?.userPreference === -1 ? 'dislike' : '')
        ]));
    }

    async function setArticleFetchPreference(hostname, strategy, preference) {
        const stats = await ensureArticleFetchStats();
        stats[hostname] ||= {};
        stats[hostname][strategy] ||= {
            attempts: 0,
            successes: 0,
            failures: 0,
            consecutiveFailures: 0,
            qualityPoints: 0
        };
        stats[hostname][strategy].userPreference = preference === 'like' ? 1 : (preference === 'dislike' ? -1 : 0);
        stats[hostname][strategy].lastPreferenceAt = new Date().toISOString();
        scheduleArticleFetchStatsSave();
        return getArticleFetchPreferences(hostname);
    }

    async function recordArticleFetchOutcome(hostname, strategy, succeeded, error = '') {
        const stats = await ensureArticleFetchStats();
        stats[hostname] ||= {};
        const current = stats[hostname][strategy] || {
            attempts: 0,
            successes: 0,
            failures: 0,
            consecutiveFailures: 0,
            qualityPoints: 0
        };
        current.attempts += 1;
        current.lastAttemptAt = new Date().toISOString();
        if (succeeded) {
            current.successes += 1;
            current.consecutiveFailures = 0;
            current.qualityPoints = Math.min(50, Math.round((current.qualityPoints || 0) * 0.8 + 12));
            current.lastSuccessAt = current.lastAttemptAt;
            current.lastError = '';
        } else {
            current.failures += 1;
            current.consecutiveFailures += 1;
            current.qualityPoints = Math.max(-100, Math.round((current.qualityPoints || 0) * 0.8 - 25));
            current.lastError = String(error || 'No usable article content').slice(0, 240);
        }
        stats[hostname][strategy] = current;
        scheduleArticleFetchStatsSave();
    }

    function getRootDomain(urlStr) {
        return sourceFetchPolicyIdentity(urlStr);
    }

    function normalizeConfiguredSourceFetchMethods(fetchMethods) {
        return Array.isArray(fetchMethods)
            ? [...new Set(fetchMethods.filter(method => method in ARTICLE_FETCH_BASE_POINTS))]
            : [];
    }

    function sourceFetchMethodsMatch(left, right) {
        return JSON.stringify(normalizeConfiguredSourceFetchMethods(left)) ===
            JSON.stringify(normalizeConfiguredSourceFetchMethods(right));
    }

    async function synchronizeConfiguredSourceFetchMethods(source, fetchMethods, suppliedFeeds = null) {
        const identity = sourceFetchPolicyIdentity(source);
        if (!identity) throw new Error('Could not identify this source publisher.');
        const normalizedFetchMethods = normalizeConfiguredSourceFetchMethods(fetchMethods);
        const feeds = Array.isArray(suppliedFeeds)
            ? suppliedFeeds
            : await env.RSS_DATA.get('feeds', { type: 'json' }) || [];
        const synchronizedFeeds = feeds.map(feed =>
            sourceFetchPolicyIdentity(feed) === identity
                ? { ...feed, fetchMethods: [...normalizedFetchMethods] }
                : feed
        );

        const [synchronizedSmartSources] = await Promise.all([
            smartNews.setSourceFetchMethodsByIdentity(
                identity,
                normalizedFetchMethods
            ),
            env.RSS_DATA.put('feeds', JSON.stringify(synchronizedFeeds))
        ]);

        return {
            identity,
            feeds: synchronizedFeeds,
            sources: synchronizedSmartSources
        };
    }

    async function reconcileAllConfiguredSourceFetchMethods() {
        const feeds = await env.RSS_DATA.get('feeds', { type: 'json' }) || [];
        const sources = await smartNews.getSourceSettings();
        const strictPolicyByIdentity = new Map();

        // Existing installations did not keep duplicate source rows in sync.
        // Preserve the first strict policy for a publisher (normal feeds take
        // precedence), then copy it to every normal and Smart occurrence.
        for (const source of [...feeds, ...sources]) {
            const identity = sourceFetchPolicyIdentity(source);
            const methods = normalizeConfiguredSourceFetchMethods(source?.fetchMethods);
            if (identity && methods.length && !strictPolicyByIdentity.has(identity)) {
                strictPolicyByIdentity.set(identity, methods);
            }
        }

        let feedsChanged = false;
        const synchronizedFeeds = feeds.map(feed => {
            const methods = strictPolicyByIdentity.get(sourceFetchPolicyIdentity(feed)) || [];
            if (sourceFetchMethodsMatch(feed.fetchMethods, methods)) return feed;
            feedsChanged = true;
            return { ...feed, fetchMethods: [...methods] };
        });

        let sourcesChanged = false;
        const synchronizedSources = sources.map(source => {
            const methods = strictPolicyByIdentity.get(sourceFetchPolicyIdentity(source)) || [];
            if (sourceFetchMethodsMatch(source.fetchMethods, methods)) return source;
            sourcesChanged = true;
            return { ...source, fetchMethods: [...methods] };
        });

        if (feedsChanged) {
            await env.RSS_DATA.put('feeds', JSON.stringify(synchronizedFeeds));
        }
        if (sourcesChanged) {
            await env.RSS_DATA.put('smartSources', JSON.stringify(synchronizedSources));
        }

        return { feeds: synchronizedFeeds, sources: synchronizedSources };
    }

    return {
        reconcileAllConfiguredSourceFetchMethods,
        getArticleFetchPolicy,
        recordArticleFetchOutcome,
        synchronizeConfiguredSourceFetchMethods,
        getRootDomain,
        ARTICLE_FETCH_BASE_POINTS,
        normalizeConfiguredSourceFetchMethods,
        setArticleFetchPreference,
        rankArticleFetchStrategies,
        getArticleFetchPreferences
    };
}
