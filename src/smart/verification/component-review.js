import { acceptAiSideTask, primaryDecision } from '../prefilter/ai.js';
import { requestClusteringDecision } from '../../ai/clustering-json.js';
import { getGeminiWebCooldownState } from '../../ai/gemini-web.js';
import { globalAiTaskActive, runGlobalAiTask } from '../../ai/global-ai-scheduler.js';
import { freshestPublishedAt } from '../dates/publication-time.js';
import { sleep } from '../refresh/scheduling.js';
import { getCachedComponentVerificationDecision, setCachedComponentVerificationDecision } from './cache.js';
import { isModelOutputError, isTransientProviderError, providerDeferredError } from './diagnostics.js';
import { buildComponentReviewPrompt } from './prompts.js';
import { providerReviewComponentLimit } from './provider-config.js';
import { recordProviderAttempt, recordProviderSuccess, recordProviderCooldown, recordProviderError } from './provider-health.js';
import { callVerificationProvider } from './providers.js';
import { COMPONENT_REVIEW_RESPONSE_SCHEMA } from './schemas.js';
import { validateComponentReviewResult, expandComponentReviewDecision, validatePartitionResult, postValidatePartition } from './validation.js';

async function attemptComponentProviderVerification(
  provider,
  group,
  units,
  keyManager,
  db
) {
  const reviewLimit = providerReviewComponentLimit(provider);
  if (Number.isFinite(reviewLimit) && units.length > reviewLimit) {
    const error = new Error(
      `${provider.type === 'ollama' ? 'Local' : 'Online'} component review is too large: ${units.length} > ${reviewLimit}`
    );
    error.code = 'GROUP_TOO_LARGE';
    error.nonProviderFault = true;
    return { valid: false, uncertain: true, skipped: true, error };
  }

  const reviewArticles =
    group.fullRepartition && Array.isArray(group.reviewUniverse) && group.reviewUniverse.length
      ? group.reviewUniverse
      : group.articles;
  const reviewSpec = {
    componentReview: true,
    units,
    prompt: buildComponentReviewPrompt(units),
    schema: COMPONENT_REVIEW_RESPONSE_SCHEMA,
    operation: 'cluster-verification-components',
    maxOutputTokens: 4096
  };
  const maximumAttempts = Number(provider.maxRetries || 0) + 1;

  for (let attempt = 1; attempt <= maximumAttempts; attempt++) {
    const attemptStartedAt = Date.now();
    await recordProviderAttempt(db, provider);
    let parsed;

    try {
      parsed = await requestClusteringDecision({
        request: repairPrompt =>
          callVerificationProvider(
            provider,
            group,
            keyManager,
            repairPrompt,
            reviewSpec
          ),
        validate: value => validateComponentReviewResult(primaryDecision(value), units),
        schema: COMPONENT_REVIEW_RESPONSE_SCHEMA,
        onEvent: (event, error) => {
          group.diagnostics ||= {};
          group.diagnostics[event] = (group.diagnostics[event] || 0) + 1;
          if (group.metrics && event !== 'firstPassAiCalls') {
            group.metrics[event] = (group.metrics[event] || 0) + 1;
          }
          if (event === 'firstPassAiCalls' || event === 'repairAttempts') {
            group.onStage?.(
              event === 'repairAttempts' ? 'smart-ai-repair' : 'smart-ai',
              {
                providerId: provider.id,
                model: provider.model,
                reviewMode: 'components',
                reviewUnitCount: units.length,
                rawArticleCount: reviewArticles.length
              }
            );
          }
          console.log(
            '[SMART JSON]',
            JSON.stringify({
              provider: provider.id,
              model: provider.model,
              operation: 'cluster-verification-components',
              event,
              reason: error?.reason,
              reviewUnitCount: units.length
            })
          );
        }
      });

      const validation = validateComponentReviewResult(primaryDecision(parsed), units);
      if (!validation.valid) {
        const error = new Error(`Invalid component review: ${validation.reason}`);
        error.code = 'INVALID_PARTITION';
        throw error;
      }

      const confidenceFloor =
        provider.id === 'antigravity-low'
          ? 0.95
          : provider.id === 'antigravity-medium'
            ? 0.925
            : 0.9;
      const weakSameEvent = parsed.exactEventGroups.some(
        exactGroup => exactGroup.componentIds.length > 1 && exactGroup.confidence < confidenceFloor
      );
      const weakRelationship = parsed.relatedDevelopments.some(
        relation => relation.confidence < confidenceFloor
      );

      if (parsed.uncertain || weakSameEvent || weakRelationship) {
        const isAntigravity = provider.type === 'antigravity';
        const effort =
          provider.id === 'antigravity-low'
            ? 'Low'
            : provider.id === 'antigravity-medium'
              ? 'Medium'
              : provider.id === 'antigravity-high'
                ? 'High'
                : null;
        const error = new Error(
          isAntigravity
            ? `${effort}-effort Antigravity component review requires next-provider review`
            : 'Component review is uncertain or below the safe confidence threshold'
        );
        error.code =
          isAntigravity
            ? 'ANTIGRAVITY_ESCALATION_REQUIRED'
            : 'COMPONENT_REVIEW_UNCERTAIN';
        error.expectedEscalation = true;
        error.onlineAiUsage = parsed?.onlineAiUsage || null;
        throw error;
      }

      const expanded = expandComponentReviewDecision(parsed, units);
      if (
        !validatePartitionResult(
          { clusters: expanded.clusters, uncertain: false },
          reviewArticles
        ).valid ||
        !postValidatePartition(expanded, reviewArticles)
      ) {
        const error = new Error('Component-level exact-event merge failed deterministic post-validation');
        error.code = 'POST_VALIDATION_FAILED';
        throw error;
      }

      await acceptAiSideTask(db, group, parsed, 'event_verification');
      await recordProviderSuccess(db, provider);

      if (provider.type === 'gemini' || provider.type === 'antigravity') {
        console.log(
          '[ONLINE AI]',
          JSON.stringify({
            at: new Date().toISOString(),
            provider: provider.type === 'antigravity' ? 'antigravity' : 'gemini',
            operation: 'smart-component-review',
            providerId: provider.id,
            model: provider.model,
            status: 'success',
            durationMs: Date.now() - attemptStartedAt,
            groupId: group?.id || null,
            articleCount: reviewArticles.length,
            componentCount: units.length,
            exactEventGroupCount: expanded.clusters.length,
            relatedDevelopmentCount: expanded.storyRelationships.length,
            promptTokens: Number(parsed?.onlineAiUsage?.promptTokens) || 0,
            outputTokens: Number(parsed?.onlineAiUsage?.outputTokens) || 0,
            totalTokens: Number(parsed?.onlineAiUsage?.totalTokens) || 0
          })
        );
      }

      return {
        valid: true,
        uncertain: false,
        clusters: expanded.clusters,
        storyRelationships: expanded.storyRelationships,
        componentDecision: {
          exactEventGroups: parsed.exactEventGroups,
          relatedDevelopments: parsed.relatedDevelopments,
          uncertain: false
        },
        reviewMode: 'components'
      };
    } catch (error) {
      if (
        (
          provider.type === 'gemini' ||
          provider.type === 'antigravity'
        ) &&
        error?.skipProvider !== true
      ) {
        console.log(
          '[ONLINE AI]',
          JSON.stringify({
            at: new Date().toISOString(),
            provider: provider.type === 'antigravity' ? 'antigravity' : 'gemini',
            operation: 'smart-component-review',
            providerId: provider.id,
            model: provider.model,
            status:
  error?.skipProvider === true
    ? 'skipped'
    : 'failed',
            errorCode: String(error?.code || error?.name || 'UNKNOWN').slice(0, 80),
            error: String(error?.message || error || 'Unknown component review error').replace(/\s+/g, ' ').slice(0, 800),
            durationMs: Date.now() - attemptStartedAt,
            groupId: group?.id || null,
            articleCount: reviewArticles.length,
            componentCount: units.length,
            promptTokens: Number(error?.onlineAiUsage?.promptTokens) || 0,
            outputTokens: Number(error?.onlineAiUsage?.outputTokens) || 0,
            totalTokens: Number(error?.onlineAiUsage?.totalTokens) || 0
          })
        );
      }

      if (
        error?.skipProvider === true &&
        (
          error?.code ===
            'ANTIGRAVITY_COOLDOWN' ||
          error?.code ===
            'GEMINI_WEB_COOLDOWN' ||
          error?.code ===
            'GEMINI_WEB_1095' ||
          /COOLDOWN/i.test(
            String(
              error?.code || ''
            )
          )
        )
      ) {
        await recordProviderCooldown(
          db,
          provider,
          error
        );

        console.info(
          `[SMART VERIFY SKIP] ${provider.id} ` +
          `model=${provider.model}: ` +
          `${error?.message || error}`
        );
      } else if (error?.expectedEscalation) {
        console.info(
          `[SMART VERIFY FALLBACK] ${provider.id} model=${provider.model}: ${error?.message || error}`
        );
        await recordProviderSuccess(db, provider);
      } else if (error?.code === 'GROUP_TOO_LARGE' || error?.nonProviderFault === true) {
        console.info(
          `[SMART VERIFY SKIP] ${provider.id} model=${provider.model}: ${error?.message || error}`
        );
      } else {
        console.warn(
          `[SMART VERIFY] ${provider.id} model=${provider.model} component review failed: ${error?.message || error}`
        );
        await recordProviderError(db, provider, error);
      }

      if (
        provider.type === 'gemini' &&
        keyManager?.reportError &&
        !isModelOutputError(error)
        &&
        error?.code !== 'NOT_CONFIGURED'
        &&
        Number(error?.keyIndex) > 0
      ) {
        keyManager.reportError(error);
      }

      if (
        error.repairAttempted ||
        attempt >= maximumAttempts ||
        !isTransientProviderError(error)
      ) {
        return { valid: false, uncertain: true, error };
      }

      await sleep(1000 * attempt);
    }
  }

  return {
    valid: false,
    uncertain: true,
    error: new Error('Component provider attempts exhausted')
  };
}

async function verifyComponentReviewWithProviderChain(
  group,
  units,
  providers,
  keyManager,
  db
) {
  // GLOBAL_AI_P3:verifyComponentReviewWithProviderChain
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
          'smart-news:verifyComponentReviewWithProviderChain'
      },
      () =>
        verifyComponentReviewWithProviderChain(...args)
    );
  }

  const cached = await getCachedComponentVerificationDecision(db, group, units);
  if (cached) {
    if (group.metrics) {
      group.metrics.verificationCacheHits++;
      group.metrics.cachedDecisionsReused++;
    }
    console.log(
      '[SMART VERIFY COMPONENT CACHE HIT]',
      JSON.stringify({
        groupId: group?.id || null,
        articleCount: group.articles.length,
        componentCount: units.length,
        providerId: cached.providerId || null,
        model: cached.model || null
      })
    );
    return {
      valid: true,
      uncertain: false,
      providerId: cached.providerId,
      model: cached.model,
      clusters: cached.clusters,
      storyRelationships: cached.storyRelationships || [],
      verifiedAt: cached.verifiedAt,
      attemptedProviders: [],
      resolution: 'cached',
      reviewMode: 'components',
      reviewUnitCount: units.length
    };
  }

  if (group.metrics) group.metrics.verificationCacheMisses++;

  const eligibleProviders = providers.filter(provider => {
    const limit = providerReviewComponentLimit(provider);
    return !Number.isFinite(limit) || units.length <= limit;
  });
  const skippedProviders = providers.filter(provider => !eligibleProviders.includes(provider));

  if (skippedProviders.length) {
    console.info(
      '[SMART VERIFY COMPONENT SIZE GUARD]',
      JSON.stringify({
        groupId: group?.id || null,
        articleCount: group.articles.length,
        componentCount: units.length,
        skippedProviders: skippedProviders.map(provider => ({
          providerId: provider.id,
          model: provider.model,
          limit: providerReviewComponentLimit(provider)
        }))
      })
    );
  }

  if (!eligibleProviders.length) {
    if (group.metrics) {
      group.metrics.groupsSkippedTooLarge = (group.metrics.groupsSkippedTooLarge || 0) + 1;
    }
    return {
      valid: true,
      uncertain: true,
      providerId: null,
      model: null,
      attemptedProviders: [],
      skippedProviders: skippedProviders.map(provider => ({
        providerId: provider.id,
        model: provider.model,
        limit: providerReviewComponentLimit(provider)
      })),
      resolution: 'deferred',
      reviewMode: 'components',
      reviewUnitCount: units.length,
      fallbackReason: 'component_group_too_large',
      clusters: [],
      storyRelationships: []
    };
  }

  const attemptedProviders = [];
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


  for (const provider of eligibleProviders) {
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

    if (attemptedProviders.length && group.metrics) {
      group.metrics.fallbackProviderAttempts++;
    }
    group.isFallback = attemptedProviders.length > 0;
    group.onStage?.(
      group.isFallback ? 'smart-ai-fallback' : 'smart-ai',
      {
        providerId: provider.id,
        model: provider.model,
        providerAttempt: attemptedProviders.length + 1,
        providerTotal: eligibleProviders.length,
        reviewMode: 'components',
        reviewUnitCount: units.length,
        rawArticleCount: group.articles.length
      }
    );
    attemptedProviders.push(provider.id);

    const result = await attemptComponentProviderVerification(
      provider,
      group,
      units,
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



    if (result.valid && !result.uncertain) {
      if (group.metrics) {
        group.metrics.successfulVerificationDecisions++;
        if (attemptedProviders.length > 1) group.metrics.fallbackProviderSuccesses++;
      }
      if (result.componentDecision) {
        await setCachedComponentVerificationDecision(
          db,
          group,
          units,
          result.componentDecision,
          provider
        );
      }
      return {
        valid: true,
        uncertain: false,
        providerId: provider.id,
        model: provider.model,
        clusters: result.clusters,
        storyRelationships: result.storyRelationships || [],
        verifiedAt: new Date().toISOString(),
        attemptedProviders,
        resolution: 'verified',
        reviewMode: 'components',
        reviewUnitCount: units.length
      };
    }
  }

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
    resolution: 'deferred',
    reviewMode: 'components',
    reviewUnitCount: units.length,
    fallbackReason: 'component_review_failed_or_uncertain',
    clusters: [],
    storyRelationships: []
  };
}

export { verifyComponentReviewWithProviderChain };
