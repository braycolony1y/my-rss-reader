import { acceptAiSideTask, primaryDecision } from '../prefilter/ai.js';
import { requestClusteringDecision } from '../../ai/clustering-json.js';
import { getArticleId } from '../articles/identity.js';
import { detectEventConflicts } from '../clustering/event-evidence.js';
import { sleep } from '../refresh/scheduling.js';
import { sanitizeProviderDiagnosticText, providerJsonDiagnosticFields, isModelOutputError, isTransientProviderError } from './diagnostics.js';
import { providerReviewArticleLimit } from './provider-config.js';
import { recordProviderAttempt, recordProviderError, recordProviderSuccess, recordProviderCooldown } from './provider-health.js';
import { callVerificationProvider } from './providers.js';
import { PARTITION_RESPONSE_SCHEMA } from './schemas.js';
import { validatePartitionResult, pairEligibleForVerifiedCluster, postValidatePartition } from './validation.js';

async function attemptProviderVerification(
  provider,
  group,
  keyManager,
  db
) {
  const reviewLimit =
    providerReviewArticleLimit(provider);

  if (
    Number.isFinite(reviewLimit) &&
    group.articles.length > reviewLimit
  ) {
    const error = new Error(
      `${provider.type === 'ollama' ? 'Local' : 'Online'} review group is too large: ${group.articles.length} > ${reviewLimit}`
    );
    error.code = 'GROUP_TOO_LARGE';
    error.nonProviderFault = true;

    return {
      valid: false,
      uncertain: true,
      skipped: true,
      error
    };
  }

  const maximumAttempts =
    Number(provider.maxRetries || 0) +
    1;

  for (
    let attempt = 1;
    attempt <= maximumAttempts;
    attempt++
  ) {
    const attemptStartedAt =
      Date.now();

    await recordProviderAttempt(
      db,
      provider
    );

    let parsed;
    try {
      parsed = await requestClusteringDecision({
        request: repairPrompt => callVerificationProvider(provider, group, keyManager, repairPrompt),
        validate: value => validatePartitionResult(primaryDecision(value), group.articles),
        schema: PARTITION_RESPONSE_SCHEMA,
        onEvent: (event, error) => {
          group.diagnostics ||= {};
          group.diagnostics[event] = (group.diagnostics[event] || 0) + 1;
          if (group.metrics && event !== 'firstPassAiCalls') group.metrics[event] = (group.metrics[event] || 0) + 1;
          if (event === 'firstPassAiCalls' || event === 'repairAttempts') {
            group.onStage?.(
              event === 'repairAttempts' ? 'smart-ai-repair' : 'smart-ai',
              {
                providerId: provider.id,
                model: provider.model
              }
            );
          }
          console.log('[SMART JSON]', JSON.stringify({ provider: provider.id, model: provider.model,
            operation: 'cluster-verification', event, reason: error?.reason,
            ...(process.env.SMART_LOG_AI_DEBUG === 'true' && error?.rawResponse ? { raw: sanitizeProviderDiagnosticText(error.rawResponse, 2000).text } : {}) }));
        }
      });

      if (
        provider.type === 'gemini' &&
        process.env
          .SMART_LOG_GEMINI_RESPONSES ===
          'true'
      ) {
        console.log(
          '[SMART GEMINI RESPONSE]',
          JSON.stringify({
            groupId:
              group?.id || null,
            providerId:
              provider.id,
            model:
              provider.model,
            articleCount:
              Array.isArray(
                group?.articles
              )
                ? group.articles.length
                : 0,
            response:
              parsed
          })
        );
      }

      const validation =
        validatePartitionResult(
          primaryDecision(parsed),
          group.articles
        );

      if (!validation.valid) {
        const error =
          new Error(
            `Invalid partition: ${validation.reason}`
          );

        error.code =
          'INVALID_PARTITION';

        if (
          provider.type === 'gemini' &&
          process.env
            .SMART_LOG_GEMINI_RESPONSES ===
            'true'
        ) {
          console.warn(
            '[SMART GEMINI DECISION]',
            JSON.stringify({
              groupId:
                group?.id || null,
              providerId:
                provider.id,
              model:
                provider.model,
              accepted: false,
              reason:
                validation.reason
            })
          );
        }

        await recordProviderError(
          db,
          provider,
          error
        );

        return {
          valid: false,
          uncertain: true,
          reason:
            validation.reason,
          error
        };
      }

      /*
       * Validate each returned cluster independently.
       *
       * A single invalid Gemini cluster must not discard every other
       * valid cluster in the response. Invalid or insufficiently
       * confident clusters are conservatively split into singletons.
       */
      const modelWasUncertain =
        parsed.uncertain === true;

      const articleById =
        new Map(
          group.articles.map(
            article => [
              getArticleId(article),
              article
            ]
          )
        );

      const diagnoseCluster =
        articleIds => {
          const clusterArticles =
            articleIds
              .map(id =>
                articleById.get(id)
              )
              .filter(Boolean);

          if (
            clusterArticles.length !==
            articleIds.length
          ) {
            return {
              valid: false,
              reason:
                'unknown_article_id'
            };
          }

          for (
            let left = 0;
            left <
              clusterArticles.length;
            left++
          ) {
            for (
              let right = left + 1;
              right <
                clusterArticles.length;
              right++
            ) {
              const conflicts =
                detectEventConflicts(
                  clusterArticles[left],
                  clusterArticles[right]
                );

              if (
                conflicts.hasHardConflict
              ) {
                return {
                  valid: false,
                  reason:
                    'hard_event_conflict',
                  conflictReasons:
                    conflicts.reasons
                };
              }
            }
          }

          if (
            clusterArticles.length <= 1
          ) {
            return {
              valid: true,
              reason: null
            };
          }

          const visited =
            new Set([0]);

          const queue = [0];

          while (queue.length) {
            const current =
              queue.shift();

            for (
              let candidate = 0;
              candidate <
                clusterArticles.length;
              candidate++
            ) {
              if (
                visited.has(
                  candidate
                )
              ) {
                continue;
              }

              if (
                pairEligibleForVerifiedCluster(
                  clusterArticles[current],
                  clusterArticles[candidate]
                )
              ) {
                visited.add(
                  candidate
                );

                queue.push(
                  candidate
                );
              }
            }
          }

          if (
            visited.size !==
            clusterArticles.length
          ) {
            return {
              valid: false,
              reason:
                'disconnected_under_deterministic_rules',
              connectedArticles:
                visited.size,
              totalArticles:
                clusterArticles.length
            };
          }

          return {
            valid: true,
            reason: null
          };
        };

      const safeClusters = [];
      const splitClusters = [];

      for (
        let clusterIndex = 0;
        clusterIndex <
          parsed.clusters.length;
        clusterIndex++
      ) {
        const cluster =
          parsed.clusters[
            clusterIndex
          ];

        const articleIds =
          Array.isArray(
            cluster?.articleIds
          )
            ? [...cluster.articleIds]
            : [];

        const confidence =
          Number(
            cluster?.confidence
          );

        if (
          articleIds.length <= 1
        ) {
          safeClusters.push({
            ...cluster,
            articleIds
          });

          continue;
        }

        let failure = null;

        /*
         * For an explicitly uncertain response, only retain a
         * multi-article merge when Gemini confidence is at least 0.95.
         * Deterministic validation is still required afterward.
         */
        if (
          modelWasUncertain &&
          (
            !Number.isFinite(
              confidence
            ) ||
            confidence < 0.95
          )
        ) {
          failure = {
            valid: false,
            reason:
              'uncertain_confidence_below_0.95'
          };
        }

        if (!failure) {
          const diagnosis =
            diagnoseCluster(
              articleIds
            );

          if (!diagnosis.valid) {
            failure =
              diagnosis;
          }
        }

        if (!failure) {
          safeClusters.push({
            ...cluster,
            articleIds
          });

          continue;
        }

        splitClusters.push({
          clusterIndex,
          articleIds,
          confidence:
            Number.isFinite(
              confidence
            )
              ? confidence
              : null,
          reason:
            failure.reason,
          conflictReasons:
            failure
              .conflictReasons ||
            undefined,
          connectedArticles:
            failure
              .connectedArticles,
          totalArticles:
            failure
              .totalArticles
        });

        for (
          const articleId
          of articleIds
        ) {
          safeClusters.push({
            articleIds:
              [articleId],
            confidence:
              Number.isFinite(
                confidence
              )
                ? confidence
                : 1
          });
        }
      }

      if (
        provider.type === 'antigravity' &&
        [
          'antigravity-low',
          'antigravity-medium',
          'antigravity-high'
        ].includes(provider.id) &&
        (
          modelWasUncertain ||
          splitClusters.length > 0
        )
      ) {
        const effort =
          provider.id === 'antigravity-low'
            ? 'Low'
            : provider.id === 'antigravity-medium'
              ? 'Medium'
              : 'High';
        const error =
          new Error(
            `${effort}-effort Antigravity decision requires next-provider review`
          );
        error.code =
          'ANTIGRAVITY_ESCALATION_REQUIRED';
        error.expectedEscalation = true;
        error.onlineAiUsage =
          parsed?.onlineAiUsage || null;
        throw error;
      }

      const lowConfidenceLiteMerges =
        provider.id ===
          'gemini-flash-lite'
          ? parsed.clusters.filter(
            cluster => {
              const articleIds =
                Array.isArray(
                  cluster?.articleIds
                )
                  ? cluster.articleIds
                  : [];
              const confidence =
                Number(
                  cluster?.confidence
                );

              return (
                articleIds.length > 1 &&
                (
                  !Number.isFinite(
                    confidence
                  ) ||
                  confidence < 0.9
                )
              );
            }
          )
          : [];

      if (
        provider.id ===
          'gemini-flash-lite' &&
        (
          modelWasUncertain ||
          splitClusters.length > 0 ||
          lowConfidenceLiteMerges
            .length > 0
        )
      ) {
        const error =
          new Error(
            'Flash-Lite decision requires stronger-model review'
          );

        error.code =
          'LITE_ESCALATION_REQUIRED';
        error.expectedEscalation =
          true;
        error.httpStatus =
          Number(
            parsed?.onlineAiUsage
              ?.httpStatus
          ) || 200;
        error.keyIndex =
          Number(
            parsed?.onlineAiUsage
              ?.keyIndex
          ) || null;
        error.onlineAiUsage =
          parsed?.onlineAiUsage ||
          null;

        throw error;
      }

      const safeResult = {
        clusters:
          safeClusters,
        uncertain: false
      };

      /*
       * This should always pass because every failing merge has been
       * converted into singletons. Keep a final defensive assertion.
       */
      if (
        !postValidatePartition(
          safeResult,
          group.articles
        )
      ) {
        const error =
          new Error(
            'Salvaged partition failed final validation'
          );

        error.code =
          'SALVAGED_PARTITION_INVALID';

        throw error;
      }

      parsed.clusters =
        safeClusters;

      parsed.uncertain =
        false;

      if (
        provider.type === 'gemini' &&
        process.env
          .SMART_LOG_GEMINI_RESPONSES ===
          'true'
      ) {
        console.log(
          '[SMART GEMINI DECISION]',
          JSON.stringify({
            groupId:
              group?.id || null,
            providerId:
              provider.id,
            model:
              provider.model,
            accepted: true,
            reason:
              splitClusters.length
                ? (
                  modelWasUncertain
                    ? 'conservative_uncertain_partition'
                    : 'partial_partition_salvage'
                )
                : 'verified',
            originalClusters:
              parsed.clusters.length -
              splitClusters.reduce(
                (total, cluster) =>
                  total +
                  Math.max(
                    0,
                    cluster.articleIds
                      .length - 1
                  ),
                0
              ),
            resultingClusters:
              safeClusters.length,
            splitClusterCount:
              splitClusters.length,
            splitClusters
          })
        );
      }

      await acceptAiSideTask(db, group, parsed, 'event_verification');
      await recordProviderSuccess(
        db,
        provider
      );

      if (
        provider.type === 'gemini' ||
        provider.type === 'antigravity'
      ) {
        console.log(
          '[ONLINE AI]',
          JSON.stringify({
            at:
              new Date()
                .toISOString(),
            provider:
              provider.type === 'antigravity'
                ? 'antigravity'
                : 'gemini',
            operation:
              'smart-clustering',
            providerId:
              provider.id,
            model:
              provider.model,
            status:
              'success',
            httpStatus:
              Number(
                parsed?.onlineAiUsage
                  ?.httpStatus
              ) || 200,
            keyIndex:
              Number(
                parsed?.onlineAiUsage
                  ?.keyIndex
              ) || null,
            attempt,
            durationMs:
              Date.now() -
              attemptStartedAt,
            groupId:
              group?.id || null,
            articleCount:
              Array.isArray(
                group?.articles
              )
                ? group.articles.length
                : 0,
            promptTokens:
              Number(
                parsed?.onlineAiUsage
                  ?.promptTokens
              ) || 0,
            outputTokens:
              Number(
                parsed?.onlineAiUsage
                  ?.outputTokens
              ) || 0,
            totalTokens:
              Number(
                parsed?.onlineAiUsage
                  ?.totalTokens
              ) || 0,
            ...providerJsonDiagnosticFields(
              parsed?.jsonRepairDiagnostics
            )
          })
        );
      }

      return {
        valid: true,
        uncertain: false,
        postValidationPassed: true,
        clusters:
          safeClusters,
        conservativeUncertain:
          modelWasUncertain,
        salvaged:
          splitClusters.length > 0
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
            at:
              new Date()
                .toISOString(),
            provider:
              provider.type === 'antigravity'
                ? 'antigravity'
                : 'gemini',
            operation:
              'smart-clustering',
            providerId:
              provider.id,
            model:
              provider.model,
            status:
              error?.skipProvider === true
                ? 'skipped'
                : 'failed',
            httpStatus:
              Number(
                error?.status ||
                error?.httpStatus
              ) || null,
            errorCode:
              String(
                error?.code ||
                error?.name ||
                'UNKNOWN'
              ).slice(0, 80),
            error:
              String(
                error?.message ||
                error ||
                'Unknown Gemini error'
              )
                .replace(/\s+/g, ' ')
                .slice(0, 800),
            keyIndex:
              Number(
                error?.keyIndex
              ) || null,
            attempt,
            durationMs:
              Date.now() -
              attemptStartedAt,
            groupId:
              group?.id || null,
            articleCount:
              Array.isArray(
                group?.articles
              )
                ? group.articles.length
                : 0,
            promptTokens:
              Number(
                error?.onlineAiUsage
                  ?.promptTokens
              ) || 0,
            outputTokens:
              Number(
                error?.onlineAiUsage
                  ?.outputTokens
              ) || 0,
            totalTokens:
              Number(
                error?.onlineAiUsage
                  ?.totalTokens
              ) || 0,
            ...providerJsonDiagnosticFields(
              (error?.originalRawResponse || error?.rawResponse || error?.repairAttempted)
                ? error
                : (parsed?.jsonRepairDiagnostics || error)
            )
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
          `[SMART VERIFY FALLBACK] ${provider.id} ` +
          `model=${provider.model}: ` +
          `${error?.message || error}`
        );

        await recordProviderSuccess(
          db,
          provider
        );
      } else if (
        error?.code === 'GROUP_TOO_LARGE' ||
        error?.nonProviderFault === true
      ) {
        console.info(
          `[SMART VERIFY SKIP] ${provider.id} ` +
          `model=${provider.model}: ` +
          `${error?.message || error}`
        );
      } else {
        console.warn(
          `[SMART VERIFY] ${provider.id} ` +
          `model=${provider.model} failed: ` +
          `${error?.message || error}`
        );

        await recordProviderError(
          db,
          provider,
          error
        );
      }

      if (
        provider.type ===
        'gemini' &&
        keyManager?.reportError &&
        !isModelOutputError(
          error
        )
        &&
        error?.code !== 'NOT_CONFIGURED'
        &&
        Number(error?.keyIndex) > 0
      ) {
        keyManager.reportError(
          error
        );
      }

      if (
        error.repairAttempted || attempt >=
        maximumAttempts ||
        !isTransientProviderError(
          error
        )
      ) {
        return {
          valid: false,
          uncertain: true,
          error
        };
      }

      await sleep(
        1000 * attempt
      );
    }
  }

  return {
    valid: false,
    uncertain: true,
    error:
      new Error(
        'Provider attempts exhausted'
      )
  };
}

export { attemptProviderVerification };
