import { getGeminiWebCooldownState } from '../../ai/gemini-web.js';
import { globalAiTaskActive, runGlobalAiTask } from '../../ai/global-ai-scheduler.js';
import { freshestPublishedAt } from '../dates/publication-time.js';
import { attemptProviderVerification } from './attempt.js';
import { getCachedVerificationDecision, verificationCacheKey, setCachedVerificationDecision } from './cache.js';
import { verifyComponentReviewWithProviderChain } from './component-review.js';
import { providerDeferredError } from './diagnostics.js';
import { buildComponentReviewUnits } from './prompts.js';
import { providerReviewArticleLimit } from './provider-config.js';

async function verifyWithProviderChain(
  group,
  providers,
  keyManager,
  db
) {
  // GLOBAL_AI_P3:verifyWithProviderChain
  if (!globalAiTaskActive()) {
    const args =
      Array.from(arguments);

    return runGlobalAiTask(
      {
        lane: 'p3',
        background: true,
        getFreshnessAt:
          () =>
            freshestPublishedAt(
              group?.reviewUniverse ||
              group?.articles ||
              []
            ),
        label:
          'smart-news:verifyWithProviderChain'
      },
      () =>
        verifyWithProviderChain(...args)
    );
  }

  const articleEligibleProviders = providers.filter(provider => {
    const limit = providerReviewArticleLimit(provider);
    return !Number.isFinite(limit) || group.articles.length <= limit;
  });

  if (providers.length && !articleEligibleProviders.length) {
    const componentUnits = buildComponentReviewUnits(group);
    if (componentUnits.length) {
      console.info(
        '[SMART VERIFY COMPONENT REVIEW]',
        JSON.stringify({
          groupId: group?.id || null,
          articleCount: group.articles.length,
          componentCount: componentUnits.length
        })
      );
      return verifyComponentReviewWithProviderChain(
        group,
        componentUnits,
        providers,
        keyManager,
        db
      );
    }
  }

  const cached =
    await getCachedVerificationDecision(
      db,
      group,
      providers
    );

  if (cached) {
    if (group.metrics) { group.metrics.verificationCacheHits++; group.metrics.cachedDecisionsReused++; }
    console.log(
      '[SMART VERIFY CACHE HIT]',
      JSON.stringify({
        groupId:
          group?.id || null,
        articles:
          Array.isArray(
            group?.articles
          )
            ? group.articles.length
            : 0,
        providerId:
          cached.providerId || null,
        model:
          cached.model || null
      })
    );

    return {
      valid: true,
      uncertain: false,
      providerId:
        cached.providerId,
      model:
        cached.model,
      clusters:
        cached.clusters,
      verifiedAt:
        cached.verifiedAt,
      attemptedProviders: [],
      resolution: 'cached'
    };
  }

  if (group.metrics) group.metrics.verificationCacheMisses++;
  console.log(
    '[SMART VERIFY CACHE MISS]',
    JSON.stringify({
      groupId:
        group?.id || null,
      articles:
        Array.isArray(
          group?.articles
        )
          ? group.articles.length
          : 0
    })
  );

  const failureKey = verificationCacheKey(group, providers) + ':' + providers.map(p => `${p.id}:${p.model}`).join('|');
  const failures = (await db.get('smartVerificationFailures', { type: 'json' })) || {};
  const failureRetryMs = Math.max(
    5 * 60 * 1000,
    Math.min(
      24 * 60 * 60 * 1000,
      Number(process.env.SMART_VERIFY_FAILURE_RETRY_MS) || 30 * 60 * 1000
    )
  );
  const previousFailureRecord = failures[failureKey];
  const previousFailureAt = Date.parse(previousFailureRecord?.at || '');
  const previousFailure =
    !group.forceRebuild &&
    previousFailureRecord &&
    Number.isFinite(previousFailureAt) &&
    Date.now() - previousFailureAt < failureRetryMs;
  const attemptedProviders = [];
  const eligibleProviders =
    providers.filter(
      provider => {
        const limit =
          providerReviewArticleLimit(provider);
        return (
          !Number.isFinite(limit) ||
          group.articles.length <= limit
        );
      }
    );

  const skippedProviders =
    providers.filter(
      provider =>
        !eligibleProviders.includes(provider)
    );

  if (skippedProviders.length) {
    console.info(
      '[SMART VERIFY SIZE GUARD]',
      JSON.stringify({
        groupId: group?.id || null,
        articleCount:
          group.articles.length,
        skippedProviders:
          skippedProviders.map(
            provider => ({
              providerId: provider.id,
              model: provider.model,
              limit:
                providerReviewArticleLimit(
                  provider
                )
            })
          )
      })
    );
  }

  if (
    !previousFailure &&
    providers.length &&
    !eligibleProviders.length
  ) {
    if (group.metrics) {
      group.metrics.groupsSkippedTooLarge =
        (group.metrics.groupsSkippedTooLarge || 0) + 1;
    }

    return {
      valid: true,
      uncertain: true,
      providerId: null,
      model: null,
      attemptedProviders,
      skippedProviders:
        skippedProviders.map(
          provider => ({
            providerId: provider.id,
            model: provider.model,
            limit:
              providerReviewArticleLimit(
                provider
              )
          })
        ),
      resolution: 'deferred',
      fallbackReason: 'group_too_large',
      clusters: []
    };
  }

  let allowAntigravityEscalation = false;
  /*
   * Earliest known ONLINE recovery deadline.
   *
   * No polling:
   * provider cooldown timestamps are authoritative.
   *
   * <= 5 minutes:
   *   release scheduler slot and retry online at retryAt.
   *
   * > 5 minutes:
   *   local Qwen may work while waiting.
   */
  let earliestOnlineRetryAt = 0;

  const noteOnlineRetryAt = value => {
    const numeric =
      Number(value);

    const parsed =
      numeric ||
      (
        value
          ? Date.parse(value)
          : 0
      ) ||
      0;

    if (
      parsed <= Date.now()
    ) {
      return;
    }

    if (
      !earliestOnlineRetryAt ||
      parsed < earliestOnlineRetryAt
    ) {
      earliestOnlineRetryAt =
        parsed;
    }
  };

  const initialWebState =
    getGeminiWebCooldownState();

  if (
    initialWebState?.retryAt >
      Date.now()
  ) {
    noteOnlineRetryAt(
      initialWebState.retryAt
    );
  }


  for (const provider of previousFailure ? [] : eligibleProviders) {
    if (
      provider.type === 'antigravity' &&
      provider.id !== 'antigravity-low' &&
      !allowAntigravityEscalation
    ) {
      /*
       * Medium/high effort is reserved for explicit model uncertainty.
       * Ordinary Antigravity failure goes directly to the API backup.
       */
      continue;
    }

    /*
     * Gemini Web cooldown state is already known.
     * Do not probe it repeatedly.
     */
    if (
      provider.type === 'gemini-web'
    ) {
      const webState =
        getGeminiWebCooldownState();

      if (
        webState?.retryAt >
          Date.now()
      ) {
        noteOnlineRetryAt(
          webState.retryAt
        );

        continue;
      }
    }

    /*
     * Qwen is considered only after the online chain.
     */
    if (
      provider.type === 'ollama'
    ) {
      const remaining =
        earliestOnlineRetryAt -
        Date.now();

      /*
       * Online recovery within five minutes:
       * don't waste CPU starting Qwen.
       */
      if (
        remaining > 0 &&
        remaining <=
          5 * 60 * 1000
      ) {
        throw providerDeferredError(
          earliestOnlineRetryAt,
          'online AI retry within 5 minutes'
        );
      }

      /*
       * For a long recorded cooldown Qwen may run.
       * The deadline is carried with the task so the
       * local request can later be aborted exactly when
       * online AI becomes eligible again.
       */
      group.onlineRetryAt =
        remaining >
          5 * 60 * 1000
          ? earliestOnlineRetryAt
          : 0;
    }

    const providerAttempt = attemptedProviders.length + 1;
    if (attemptedProviders.length) {
      if (group.metrics) group.metrics.fallbackProviderAttempts++;
    }
    group.isFallback = attemptedProviders.length > 0;
    group.onStage?.(
      group.isFallback ? 'smart-ai-fallback' : 'smart-ai',
      {
        providerId: provider.id,
        model: provider.model,
        providerAttempt,
        providerTotal: eligibleProviders.length
      }
    );
    attemptedProviders.push(
      provider.id
    );

    const result =
      await attemptProviderVerification(
        provider,
        group,
        keyManager,
        db
      );

    /*
     * Temporary online states are NOT permanent failures.
     * Record their already-known recovery timestamp.
     */
    if (
      provider.type !== 'ollama' &&
      result?.error
    ) {
      noteOnlineRetryAt(
        result.error.retryAt ||
        result.error.cooldownUntil
      );

      if (
        provider.type ===
          'gemini-web'
      ) {
        const webState =
          getGeminiWebCooldownState();

        noteOnlineRetryAt(
          webState?.retryAt
        );

        /*
         * Browser contention is temporary too.
         * No polling: just schedule one short retry point
         * when Web has not supplied another retryAt.
         */
        if (
          result.error.code ===
            'GEMINI_WEB_BUSY' &&
          !(
            webState?.retryAt >
              Date.now()
          )
        ) {
          noteOnlineRetryAt(
            Date.now() + 2000
          );
        }
      }
    }


    if (
      provider.type === 'antigravity'
    ) {
      /*
       * Only explicit uncertainty is allowed to unlock the next
       * Antigravity effort level. Any ordinary failure resets escalation,
       * so the next provider considered is the API backup.
       */
      allowAntigravityEscalation =
        result?.error?.code ===
        'ANTIGRAVITY_ESCALATION_REQUIRED';
    }



    if (
      result.valid &&
      !result.uncertain &&
      result.postValidationPassed
    ) {
      if (group.metrics) { group.metrics.successfulVerificationDecisions++; if (attemptedProviders.length > 1) group.metrics.fallbackProviderSuccesses++; }
      const finalResult = {
        valid: true,
        uncertain: false,
        providerId:
          provider.id,
        model:
          provider.model,
        clusters:
          result.clusters,
        verifiedAt:
          new Date().toISOString(),
        attemptedProviders,
        resolution:
          'verified'
      };

      if (failures[failureKey]) { delete failures[failureKey]; await db.put('smartVerificationFailures', JSON.stringify(failures)); }
      await setCachedVerificationDecision(
        db,
        group,
        providers,
        finalResult
      );

      return finalResult;
    }
  }

  if (!previousFailure) { failures[failureKey] = { at: new Date().toISOString(), reason: 'all_providers_failed_or_uncertain' }; await db.put('smartVerificationFailures', JSON.stringify(failures)); }
  /*
   * A known temporary online recovery must not be
   * converted into an all-provider failure.
   */
  {
    const remaining =
      earliestOnlineRetryAt -
      Date.now();

    if (
      remaining > 0 &&
      remaining <=
        5 * 60 * 1000
    ) {
      throw providerDeferredError(
        earliestOnlineRetryAt,
        'online AI retry within 5 minutes'
      );
    }
  }

  if (group.metrics) group.metrics.allProviderFailures++;
  return {
    valid: true,
    uncertain: true,
    providerId: null,
    model: null,
    attemptedProviders,
    skippedProviders:
      skippedProviders.map(provider => ({
        providerId: provider.id,
        model: provider.model,
        limit: providerReviewArticleLimit(provider)
      })),
    // Provider unavailability or model uncertainty is not a clustering
    // decision. Preserve deterministic components, persist the review request
    // for a later attempt, and continue with the rest of the refresh.
    resolution: 'deferred',
    reviewMode: 'articles',
    reviewUnitCount: group.articles.length,
    fallbackReason:
      providers.length
        ? (
          eligibleProviders.length
            ? 'all_providers_failed_or_uncertain'
            : 'group_too_large'
        )
        : 'no_provider_configured',
    clusters: []
  };
}

export { verifyWithProviderChain };
