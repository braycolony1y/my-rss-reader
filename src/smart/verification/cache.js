import { getArticleId } from '../articles/identity.js';
import { detectArticleLanguage } from '../articles/language.js';
import { SMART_CLUSTER_VERSION, SMART_NEWS_AI_CONFIG } from '../config.js';
import { validateComponentReviewResult, expandComponentReviewDecision, validatePartitionResult, postValidatePartition } from './validation.js';
import { createHash } from 'node:crypto';

let verificationCacheWriteChain = Promise.resolve();

function componentVerificationCacheKey(group, units) {
  const payload = {
    kind: 'component-relationship-review-v1',
    components: units.map(unit => ({
      id: unit.id,
      articleIds: unit.articleIds,
      representativeTitle: unit.representativeTitle,
      representativeExcerpt: unit.representativeExcerpt,
      publishedFrom: unit.publishedFrom,
      publishedTo: unit.publishedTo,
      headlines: unit.headlines
    })),
    promptVersion: 'component-relationship-v3-generic-recovery',
    schemaVersion: 'component-relationship-v1',
    clusterVersion: SMART_CLUSTER_VERSION
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

async function getCachedComponentVerificationDecision(db, group, units) {
  if (!SMART_NEWS_AI_CONFIG.cache.enabled) return null;
  const cache = await getVerificationCache(db);
  const key = componentVerificationCacheKey(group, units);
  const entry = cache && typeof cache === 'object' ? cache[key] : null;
  if (!entry || group.forceRebuild) return null;

  const validation = validateComponentReviewResult(entry.result, units);
  if (!validation.valid || entry.result.uncertain) return null;
  const expanded = expandComponentReviewDecision(entry.result, units);
  const reviewArticles =
    group.fullRepartition && Array.isArray(group.reviewUniverse) && group.reviewUniverse.length
      ? group.reviewUniverse
      : group.articles;
  if (
    !validatePartitionResult({ clusters: expanded.clusters, uncertain: false }, reviewArticles).valid ||
    !postValidatePartition(expanded, reviewArticles)
  ) {
    return null;
  }

  return {
    providerId: entry.providerId,
    model: entry.model,
    verifiedAt: entry.verifiedAt,
    clusters: expanded.clusters,
    storyRelationships: expanded.storyRelationships
  };
}

async function setCachedComponentVerificationDecision(db, group, units, result, provider) {
  if (!SMART_NEWS_AI_CONFIG.cache.enabled) return;
  const validation = validateComponentReviewResult(result, units);
  if (!validation.valid || result.uncertain) return;

  verificationCacheWriteChain = verificationCacheWriteChain.catch(() => {}).then(async () => {
    const cache = await getVerificationCache(db);
    const key = componentVerificationCacheKey(group, units);
    cache[key] = {
      kind: 'component-relationship-review-v1',
      providerId: provider.id,
      model: provider.model,
      verifiedAt: new Date().toISOString(),
      createdAt: Date.now(),
      result: {
        exactEventGroups: result.exactEventGroups,
        relatedDevelopments: result.relatedDevelopments,
        uncertain: false
      }
    };
    await db.put('smartEventVerificationCache', JSON.stringify(cache));
  });

  try {
    await verificationCacheWriteChain;
  } catch (error) {
    console.error('[SMART] Failed to save component verification cache:', error.message);
  }
}

function normalizedVerificationArticles(articles) {
  return articles.map(article => ({ id: getArticleId(article), title: article.title,
    description: String(article.content || '').slice(0, 600), source: article.feedTitle,
    domain: article.domain, language: article.language || detectArticleLanguage(article),
    category: article.smartCategory, publishedAt: article.pubDate
  })).sort((a, b) => a.id.localeCompare(b.id));
}

function verificationCacheKey(
  group,
  providers
) {
  const payload = {
    articles:
      normalizedVerificationArticles(
        group.articles
      ),

    /*
     * Do not include the current enabled provider stack.
     * Gemini key availability and provider order can change between
     * refreshes without changing the correctness of cached results.
     */
    verificationCacheKeyVersion:
      'effective-input-v2',

    promptVersion:
      SMART_NEWS_AI_CONFIG
        .cache
        .promptVersion,

    rulesVersion:
      SMART_NEWS_AI_CONFIG
        .cache
        .rulesVersion,

    schemaVersion:
      SMART_NEWS_AI_CONFIG
        .cache
        .schemaVersion,

    clusterVersion:
      SMART_CLUSTER_VERSION
  };

  return createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex');
}

async function getVerificationCache(db) {
  try {
    return (
      await db.get(
        'smartEventVerificationCache',
        {
          type: 'json'
        }
      )
    ) || {};
  } catch {
    return {};
  }
}

async function getCachedVerificationDecision(
  db,
  group,
  providers
) {
  if (
    !SMART_NEWS_AI_CONFIG
      .cache
      .enabled
  ) {
    return null;
  }

  const cache =
    await getVerificationCache(db);

  const key =
    verificationCacheKey(
      group,
      providers
    );

  const entry = cache && typeof cache === 'object' ? cache[key] : null;

  if (group.forceRebuild && entry) {
    if (group.metrics) { group.metrics.cachedDecisionsInvalidated++; group.metrics.invalidationReason = 'explicit_force_rebuild'; }
    return null;
  }
  if (!entry) return null;

  const validation =
    validatePartitionResult(
      entry.result,
      group.articles
    );

  if (
    !validation.valid ||
    entry.result.uncertain ||
    !postValidatePartition(
      entry.result,
      group.articles
    )
  ) {
    if (group.metrics) { group.metrics.cachedDecisionsInvalidated++; group.metrics.invalidationReason = 'cached_decision_failed_validation'; }
    return null;
  }

  return {
    ...entry.result,
    providerId:
      entry.providerId,
    model:
      entry.model,
    verifiedAt:
      entry.verifiedAt
  };
}

async function setCachedVerificationDecision(
  db,
  group,
  providers,
  result
) {
  if (
    !SMART_NEWS_AI_CONFIG
      .cache
      .enabled
  ) {
    return;
  }

  if (!validatePartitionResult({ clusters: result.clusters, uncertain: result.uncertain }, group.articles).valid || result.uncertain || !postValidatePartition(result, group.articles)) return;

  verificationCacheWriteChain =
    verificationCacheWriteChain.catch(() => {}).then(
      async () => {
        const cache =
          await getVerificationCache(
            db
          );

        const key =
          verificationCacheKey(
            group,
            providers
          );

        const now = Date.now();

        cache[key] = {
          providerId:
            result.providerId,
          model:
            result.model,
          verifiedAt:
            result.verifiedAt,
          createdAt: now,
          result: {
            clusters:
              result.clusters,
            uncertain: false
          }
        };

        await db.put(
          'smartEventVerificationCache',
          JSON.stringify(
            cache
          )
        );
      }
    );

  try {
    await verificationCacheWriteChain;
  } catch (error) {
    console.error(
      '[SMART] Failed to save verification cache:',
      error.message
    );
  }
}

export { componentVerificationCacheKey, getCachedComponentVerificationDecision, setCachedComponentVerificationDecision, normalizedVerificationArticles, verificationCacheKey, getVerificationCache, getCachedVerificationDecision, setCachedVerificationDecision };
