import { getGeminiWebCooldownState } from '../../ai/gemini-web.js';
import { runGlobalAiTask } from '../../ai/global-ai-scheduler.js';
import { prepareSmartEditorialPlan, buildSmartEditorialPrompt, SMART_EDITORIAL_RESPONSE_SCHEMA, parseSmartEditorialResponse, SMART_EDITORIAL_POLICY_VERSION, applySmartEditorialAssessment } from '../../ai/smart-editorial.js';
import { freshestPublishedAt } from '../dates/publication-time.js';
import { sleep } from '../refresh/scheduling.js';
import { isModelOutputError, isTransientProviderError } from '../verification/diagnostics.js';
import { recordProviderAttempt, recordProviderSuccess, recordProviderCooldown, recordProviderError } from '../verification/provider-health.js';
import { callVerificationProvider } from '../verification/providers.js';

async function assessSmartEditorialClusters({
  clusters,
  sources,
  providers,
  keyManager,
  db,
  notify,
  metrics
}) {
  let cache =
    {};

  try {
    cache =
      JSON.parse(
        (
          await db.get(
            'smartEditorialAssessmentCache'
          )
        ) || '{}'
      );
  } catch {
    cache = {};
  }

  const perDestination =
    Math.max(
      5,
      Math.min(
        100,
        Number(
          process.env
            .SMART_EDITORIAL_PER_DESTINATION
        ) || 30
      )
    );

  const onlineBatchSize =
    Math.max(
      1,
      Math.min(
        12,
        Number(
          process.env
            .SMART_EDITORIAL_BATCH_SIZE
        ) || 12
      )
    );

  const localBatchSize =
    Math.max(
      1,
      Math.min(
        4,
        Number(
          process.env
            .SMART_EDITORIAL_LOCAL_BATCH_SIZE
        ) || 4
      )
    );

  const plan =
    prepareSmartEditorialPlan({
      clusters,
      sources,
      cache,
      perDestination
    });

  // Background freshness changes PROCESSING ORDER only. It does not change
  // editorial eligibility, significance, ranking, clustering, or the 7-day
  // corpus. A mixed-age cluster stays intact and uses its freshest member.
  const selected =
    [...plan.selected]
      .sort(
        (left, right) =>
          freshestPublishedAt([
            right.cluster,
            ...(right.cluster?.relatedArticles || [])
          ]) -
          freshestPublishedAt([
            left.cluster,
            ...(left.cluster?.relatedArticles || [])
          ])
      );

  const stats = {
    cacheHits:
      plan.cacheHits,
    selected:
      selected.length,
    assessed: 0,
    failed: 0,
    aiCalls: 0,
    pending:
      plan.pendingCount,
    providerIds: []
  };

  if (
    !selected.length ||
    !providers.length
  ) {
    return stats;
  }

  let cacheChanged = false;
  const providerIds =
    new Set();

  const callEditorialProvider =
    async (
      provider,
      providerBatch,
      group
    ) => {
      const prompt =
        buildSmartEditorialPrompt(
          providerBatch
        );

      const freshnessAt =
        freshestPublishedAt(
          providerBatch.flatMap(
            item => [
              item.cluster,
              ...(item.cluster?.relatedArticles || [])
            ]
          )
        );

      const raw =
        await runGlobalAiTask(
          {
            lane: 'p3',
            background: true,
            freshnessAt,
            label:
              `smart-news:editorial:${
                provider.id
              }`
          },
          () =>
            callVerificationProvider(
              provider,
              group,
              keyManager,
              null,
              {
                prompt,
                schema:
                  SMART_EDITORIAL_RESPONSE_SCHEMA,
                operation:
                  'smart-editorial-assessment',
                editorialReview:
                  true,
                onRequest: () => {
                  stats.aiCalls++;
                },
                maxOutputTokens:
                  2048
              }
            )
        );

      return parseSmartEditorialResponse(
        raw,
        providerBatch
      );
    };

  for (
    let offset = 0;
    offset < selected.length;
    offset += onlineBatchSize
  ) {
    const batch =
      selected.slice(
        offset,
        offset +
          onlineBatchSize
      );

    notify?.(
      'smart-editorial',
      `AI editorial assessment ${
        Math.min(
          offset +
            batch.length,
          selected.length
        )
      }/${selected.length}…`,
      {
        current:
          Math.min(
            offset +
              batch.length,
            selected.length
          ),
        total:
          selected.length
      }
    );

    const group = {
      id:
        `editorial_${offset}`,
      articles:
        batch.map(
          item =>
            item.cluster
        ),
      metrics:
        null,
      isFallback:
        false
    };

    let accepted = null;
    let lastError = null;
    let allowAntigravityEscalation =
      false;
    let shortWebRetryAt = 0;
    let retriedShortWeb = false;

    for (
      let providerIndex = 0;
      providerIndex <
        providers.length &&
        !accepted;
      providerIndex++
    ) {
      const provider =
        providers[
          providerIndex
        ];

      if (
        provider.type ===
          'antigravity' &&
        provider.id !==
          'antigravity-low' &&
        !allowAntigravityEscalation
      ) {
        continue;
      }

      if (
        provider.type ===
          'gemini-web'
      ) {
        const state =
          getGeminiWebCooldownState();

        if (
          state.enabled &&
          state.remainingMs > 0
        ) {
          if (
            state.remainingMs <=
              60_000
          ) {
            shortWebRetryAt =
              Math.max(
                shortWebRetryAt,
                state.retryAt
              );
          }

          continue;
        }
      }

      // Do not move to Qwen while Web is the last short-cooling online path.
      // This wait is OUTSIDE a global AI scheduler position.
      if (
        provider.type ===
          'ollama' &&
        shortWebRetryAt >
          Date.now() &&
        !retriedShortWeb
      ) {
        await sleep(
          Math.max(
            1,
            shortWebRetryAt -
              Date.now()
          )
        );

        const webProvider =
          providers.find(
            candidate =>
              candidate.type ===
              'gemini-web'
          );

        if (webProvider) {
          retriedShortWeb =
            true;

          try {
            await recordProviderAttempt(
              db,
              webProvider
            );

            const rows =
              await callEditorialProvider(
                webProvider,
                batch,
                group
              );

            await recordProviderSuccess(
              db,
              webProvider
            );

            accepted = {
              rows,
              provider:
                webProvider
            };

            providerIds.add(
              webProvider.id
            );

            break;
          } catch (error) {
            lastError =
              error;

            const transientWeb =
              error?.code === 'GEMINI_WEB_COOLDOWN' ||
              error?.code === 'GEMINI_WEB_TIMEOUT' ||
              error?.code === 'GEMINI_WEB_1095' ||
              error?.code === 'GEMINI_WEB_BUSY';

            if (transientWeb) {
              const webState =
                getGeminiWebCooldownState();

              shortWebRetryAt =
                Math.max(
                  shortWebRetryAt,
                  Number(
                    error.retryAt ||
                    error.cooldownUntil ||
                    webState.retryAt ||
                    (
                      error.code === 'GEMINI_WEB_BUSY'
                        ? Date.now() + 2000
                        : 0
                    )
                  ) || 0
                );

              await recordProviderCooldown(
                db,
                webProvider,
                error
              ).catch(() => {});
            } else {
              await recordProviderError(
                db,
                webProvider,
                error
              );
            }

            console.warn(
              `[SMART EDITORIAL] ${
                webProvider.id
              } transient retry: ${
                error?.message ||
                error
              }`
            );

            /*
             * Repeated timeout/cooldown is still transient.
             * Do not start Qwen for this batch.
             */
            if (transientWeb) {
              break;
            }
          }
        }
      }

      if (accepted) {
        break;
      }

      group.isFallback =
        providerIndex > 0;

      const attempts =
        Math.max(
          1,
          Number(
            provider.maxRetries ||
            0
          ) + 1
        );

      for (
        let attempt = 1;
        attempt <= attempts;
        attempt++
      ) {
        try {
          await recordProviderAttempt(
            db,
            provider
          );

          let rows;

          if (
            provider.type ===
              'ollama' &&
            batch.length >
              localBatchSize
          ) {
            rows =
              new Map();

            for (
              let localOffset = 0;
              localOffset <
                batch.length;
              localOffset +=
                localBatchSize
            ) {
              const localBatch =
                batch.slice(
                  localOffset,
                  localOffset +
                    localBatchSize
                );

              const localRows =
                await callEditorialProvider(
                  provider,
                  localBatch,
                  {
                    ...group,
                    id:
                      `${group.id}_local_${
                        localOffset
                      }`,
                    articles:
                      localBatch.map(
                        item =>
                          item.cluster
                      )
                  }
                );

              for (
                const [id, row]
                of localRows
              ) {
                rows.set(
                  id,
                  row
                );
              }
            }
          } else {
            rows =
              await callEditorialProvider(
                provider,
                batch,
                group
              );
          }

          await recordProviderSuccess(
            db,
            provider
          );

          accepted = {
            rows,
            provider
          };

          providerIds.add(
            provider.id
          );

          break;
        } catch (error) {
          lastError =
            error;

          if (
            provider.type ===
              'gemini-web' &&
            (
              error?.code === 'GEMINI_WEB_COOLDOWN' ||
              error?.code === 'GEMINI_WEB_TIMEOUT' ||
              error?.code === 'GEMINI_WEB_1095' ||
              error?.code === 'GEMINI_WEB_BUSY'
            )
          ) {
            const webState =
              getGeminiWebCooldownState();

            const retryAt =
              Number(
                error.retryAt ||
                error.cooldownUntil ||
                webState.retryAt ||
                (
                  error.code === 'GEMINI_WEB_BUSY'
                    ? Date.now() + 2000
                    : 0
                )
              ) || 0;

            const remaining =
              retryAt -
              Date.now();

            if (
              remaining > 0 &&
              remaining <= 5 * 60 * 1000
            ) {
              shortWebRetryAt =
                Math.max(
                  shortWebRetryAt,
                  retryAt
                );
            }
          }

          if (
            error?.skipProvider ===
              true ||
            error?.nonProviderFault ===
              true
          ) {
            await recordProviderCooldown(
              db,
              provider,
              error
            ).catch(() => {});
          } else if (
            error?.expectedEscalation
          ) {
            await recordProviderSuccess(
              db,
              provider
            );
          } else {
            await recordProviderError(
              db,
              provider,
              error
            );
          }

          console.warn(
            `[SMART EDITORIAL] ${
              provider.id
            } model=${
              provider.model
            } attempt=${
              attempt
            }/${
              attempts
            }: ${
              error?.message ||
              error
            }`
          );

          if (
            provider.type ===
              'gemini' &&
            keyManager?.reportError &&
            !isModelOutputError(
              error
            ) &&
            error?.code !==
              'NOT_CONFIGURED' &&
            Number(
              error?.keyIndex
            ) > 0
          ) {
            keyManager.reportError(
              error
            );
          }

          if (
            provider.type ===
              'antigravity'
          ) {
            allowAntigravityEscalation =
              error?.code ===
                'ANTIGRAVITY_ESCALATION_REQUIRED';
          }

          if (
            error?.skipProvider ===
              true ||
            error?.nonProviderFault ===
              true ||
            error?.repairAttempted ||
            attempt >= attempts ||
            !isTransientProviderError(
              error
            )
          ) {
            break;
          }

          await sleep(
            1000 *
              attempt
          );
        }
      }

      if (
        provider.type ===
          'antigravity' &&
        accepted
      ) {
        allowAntigravityEscalation =
          false;
      }
    }

    if (!accepted) {
      const webStillPending =
        shortWebRetryAt > 0;

      if (webStillPending) {
        stats.pending +=
          batch.length;
      } else {
        stats.failed +=
          batch.length;
      }

      // Failure is transient/deferred state, NOT a completed assessment.
      // Remove old failure-only cache records so fresh stories are reconsidered.
      for (const item of batch) {
        if (
          cache[item.key] &&
          !cache[item.key]
            ?.assessment
        ) {
          delete cache[
            item.key
          ];

          cacheChanged =
            true;
        }
      }

      continue;
    }

    for (const item of batch) {
      const row =
        accepted.rows.get(
          item.id
        );

      if (!row) {
        stats.failed++;
        continue;
      }

      const assessment = {
        policyVersion:
          SMART_EDITORIAL_POLICY_VERSION,
        revision:
          item.key,
        eligibleDestinations:
          item.eligibleDestinations,
        destination:
          row.destination,
        relevance:
          row.relevance,
        impact:
          row.impact,
        novelty:
          row.novelty,
        confidence:
          row.confidence,
        exclude:
          row.exclude,
        reason:
          row.reason,
        providerId:
          accepted.provider.id,
        model:
          accepted.provider.model,
        assessedAt:
          new Date()
            .toISOString()
      };

      applySmartEditorialAssessment(
        item.cluster,
        assessment
      );

      cache[item.key] = {
        createdAt:
          Date.now(),
        assessment
      };

      stats.assessed++;
      cacheChanged =
        true;
    }
  }

  stats.providerIds = [
    ...providerIds
  ];

  if (cacheChanged) {
    await db.put(
      'smartEditorialAssessmentCache',
      JSON.stringify(
        cache
      )
    );
  }

  return stats;
}

export { assessSmartEditorialClusters };
