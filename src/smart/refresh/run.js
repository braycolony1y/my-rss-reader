import { canonicalSmartCategory } from '../../utils/smart-destinations.js';
import { clusterSmartCandidates } from '../clustering/execute.js';
import { VALID_SMART_CATEGORIES } from '../config.js';
import { toVietnamIso } from '../dates/publication-time.js';
import { pruneEmbeddingCache, disposeEmbeddingModel } from '../embeddings/index.js';
import { publishSmartSnapshot } from '../persistence/publication.js';
import { getEnabledVerificationProviders } from '../verification/provider-config.js';
import { prepareSmartCandidates } from './candidates.js';
import { beginSmartRefresh, endSmartRefresh } from './coordination.js';
import { createSmartRefreshMetrics, recordSmartRefreshMetrics } from './metrics.js';
import { reviewSmartCandidates } from './review-publication.js';

export function createSmartRefresh({ db, helpers, headers, keyManager, hasGeminiKey, localModel, getSources, getSettings, setStatus, clusterWorkerFactory }) {
  let running = false;
  let currentProgress = {
    active: false,
    stage: 'idle',
    message:
      'Waiting for the next Smart refresh.',
    current: 0,
    total: 0,
    percent: 0,
    updatedAt:
      toVietnamIso(Date.now())
  };

  async function sync(
    onProgress = null,
    targetCategory = null,
    options = {}
  ) {
    targetCategory = targetCategory ? canonicalSmartCategory(targetCategory) : null;
    if (running) {
      return {
        ok: true,
        skipped: true,
        reason:
          'Smart refresh already running'
      };
    }

    running = true;
    beginSmartRefresh();
    let refreshLeaseActive = true;

    const startedAt =
      toVietnamIso(Date.now());

    const isTargeted =
      targetCategory &&
      VALID_SMART_CATEGORIES.has(
        targetCategory
      );

    const notify =
      (
        stage,
        message,
        extra = {}
      ) => {
        const terminal =
          stage ===
          'smart-ready' ||
          stage ===
          'smart-error';

        const progressExtra = {
          ...extra
        };
        if (currentProgress.stage !== stage) {
          for (const key of [
            'current', 'total', 'remaining', 'percent',
            'providerId', 'providerIndex', 'providerAttempt',
            'providerTotal', 'model', 'reviewGroupId',
            'reviewArticleCount', 'reviewResolution'
          ]) {
            if (!(key in progressExtra)) progressExtra[key] = undefined;
          }
        }
        const current = Number(progressExtra.current);
        const total = Number(progressExtra.total);
        if (
          Number.isFinite(current) &&
          Number.isFinite(total) &&
          total >= 0
        ) {
          progressExtra.remaining = Math.max(
            0,
            total - current
          );
          if (!Number.isFinite(Number(progressExtra.percent))) {
            progressExtra.percent = total > 0
              ? Math.round(current / total * 100)
              : 100;
          }
        }

        currentProgress = {
          ...currentProgress,
          stage,
          message,
          active: !terminal,
          updatedAt:
            toVietnamIso(
              Date.now()
            ),
          ...progressExtra
        };

        if (
          stage ===
          'smart-ready'
        ) {
          currentProgress.percent =
            100;
        }

        if (
          typeof onProgress ===
          'function'
        ) {
          onProgress(
            currentProgress
          );
        }
      };

    let smartSources = [];
    const metrics = createSmartRefreshMetrics();
    let attemptedState = null;

    try {
      smartSources =
        await getSources();

      let prepared = await prepareSmartCandidates({
        db, smartSources, getSettings, hasGeminiKey, localModel, setStatus,
        getProgress: () => currentProgress, notify, metrics, options,
        isTargeted, targetCategory, startedAt, helpers, headers,
        setAttemptedState: value => { attemptedState = value; }
      });
      if (prepared.outcome) return prepared.outcome;
      let { candidates, existingClusters, storyIdRetentionClusters, ...configuration } = prepared;
      prepared = null;
      let clustered = await clusterSmartCandidates({
        ...configuration, candidates, existingClusters, clusterWorkerFactory,
        metrics, notify, options
      });
      let publicationPromise = reviewSmartCandidates({
        ...configuration, ...clustered, candidates, existingClusters,
        storyIdRetentionClusters, isTargeted, targetCategory, startedAt,
        db, notify, keyManager, metrics
      });
      // The review stage owns the input graphs now. Drop the orchestration
      // references before its explicit collection ahead of editorial work.
      candidates = null;
      existingClusters = null;
      storyIdRetentionClusters = null;
      clustered = null;
      let publication = await publicationPromise;
      publicationPromise = null;
      const aiProvidersUsed = publication.aiProvidersUsed;
      let completionPromise = publishSmartSnapshot({
        ...configuration, ...publication, smartSources, keyManager, db, notify,
        metrics, startedAt, hasGeminiKey, localModel,
        getProgress: () => currentProgress
      });
      publication = null;
      const completed = await completionPromise;
      completionPromise = null;

      await setStatus(
        completed
      );

      notify(
        'smart-ready',
        `Smart feed ready: ${completed.clusterCount} clusters.`
      );

      console.log(
        '[SMART] Ready:',
        completed.clusterCount,
        'clusters from',
        completed.candidateCount,
        'candidates; providers:',
        aiProvidersUsed.join(', ') ||
        'none'
      );

      return {
        ok: true,
        ...completed
      };
    } catch (error) {
      if (error.code === 'CLUSTER_VERIFICATION_UNRESOLVED' && attemptedState) await db.put('smartClusteringFailedAttempt', JSON.stringify({ ...attemptedState, unresolvedAmbiguousGroups: metrics.unresolvedAmbiguousGroups }));
      notify(
        'smart-error',
        'Smart refresh failed.',
        {
          failed: true,
          error:
            error.message
        }
      );

      const failed = {
        metrics,
        state: 'error',
        startedAt,
        completedAt:
          toVietnamIso(
            Date.now()
          ),
        error:
          error.message,
        configuredSourceCount:
          smartSources.length,
        providerOrder:
          getEnabledVerificationProviders(
            hasGeminiKey()
          ).map(
            provider =>
              provider.id
          ),
        localModel,
        progress:
          currentProgress
      };

      await setStatus(failed);

      console.error(
        '[SMART] Refresh failed:',
        error.message
      );

      return {
        ok: false,
        ...failed
      };
    } finally {
      await recordSmartRefreshMetrics(db, metrics);
      if (refreshLeaseActive) {
        endSmartRefresh();
        refreshLeaseActive = false;
      }
      running = false;

      pruneEmbeddingCache();

      const idleMs = Number(process.env.SMART_EMBEDDING_WORKER_IDLE_MS) || 0;
      if (idleMs > 0) {
        setTimeout(() => {
          if (!running) {
            disposeEmbeddingModel();
          }
        }, idleMs);
      }

      if (global.gc) {
        global.gc();
      }
    }
  }

  return { sync, getProgress: () => currentProgress, isRunning: () => running };
}
