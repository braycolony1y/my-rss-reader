import { withLocalCompute } from '../../ai/local-compute.js';
import { getArticleId } from '../articles/identity.js';
import { SMART_CLUSTER_VERSION } from '../config.js';
import { EMBEDDING_CACHE_FILE } from '../embeddings/config.js';
import { attachSmartReviewProgress } from '../refresh/review-progress.js';
import { isActiveCluster } from './publication-snapshot.js';
import { prepareIncrementalReviewGroups } from './review-groups.js';

export async function clusterSmartCandidates({ candidates, existingClusters, clusterVersionChanged, storedClusterVersion, existingClusterCountBeforeRebuild, clusterWorkerFactory, metrics, notify, options }) {
// Reuse one clustering worker for the lifetime of this Node process.
  // This is required because the old ONNX ARM64 native addon cannot
  // safely be unloaded and then loaded by a replacement Worker.
  const worker = clusterWorkerFactory();

  let clusteringResult = await withLocalCompute(
    'xenova-clustering',
    () => new Promise((resolve, reject) => {
    let hasResult = false;

    const cleanup = () => {
      worker.off('message', onMessage);
    };

    const onMessage = msg => {
      if (msg.type === 'progress') {
        if (msg.progress.embeddingsReused !== undefined) Object.assign(metrics, { embeddingsReused: msg.progress.embeddingsReused, embeddingsGenerated: msg.progress.embeddingsGenerated });
        notify(
          msg.progress.phase === 'embeddings' ? 'smart-embeddings' : 'smart-matching',
          msg.progress.phase === 'embeddings' ? 'Generating embeddings…' : 'Matching stories…',
          {
            ...msg.progress,
            ...(Number.isFinite(Number(msg.progress.current))
              ? { current: Number(msg.progress.current) }
              : {}),
            ...(Number.isFinite(Number(msg.progress.total))
              ? { total: Number(msg.progress.total) }
              : {})
          }
        );
      } else if (msg.type === 'result') {
        if (hasResult) return;
        hasResult = true;
        cleanup();
        Object.assign(metrics, msg.result.metrics || {});
        resolve(msg.result);
      } else if (msg.type === 'error') {
        if (hasResult) return;
        hasResult = true;
        cleanup();
        reject(new Error(msg.error));
      }
    };

    worker.on('message', onMessage);

    const reusableExistingClusters =
      clusterVersionChanged
        ? []
        : existingClusters.filter(cluster => isActiveCluster(cluster));

    console.log(
      '[HNSW VERSION CHECK]',
      JSON.stringify({
        storedClusterVersion,
        currentClusterVersion:
          SMART_CLUSTER_VERSION,
        clusterVersionChanged,
        storedClusters:
          existingClusterCountBeforeRebuild,
        reusableClusters:
          reusableExistingClusters.length,
        cleanRebuild:
          clusterVersionChanged
      })
    );

    worker.postMessage({
      type: 'cluster',
      mode:
        process.env.SMART_CLUSTERING_MODE ||
        'incremental-hnsw',
      articles: candidates,
      existingClusters:
        reusableExistingClusters,
      cachePath:
        EMBEDDING_CACHE_FILE
    });
    })
  );

  let autoMergedClusters;
  let ambiguousGroups;
  {
    const canonicalArticleById =
      new Map(
        candidates.map(
          article => [
            getArticleId(article),
            article
          ]
        )
      );

    const rebindWorkerGroups = groups =>
      (Array.isArray(groups) ? groups : [])
        .map(group => ({
          ...group,
          articles:
            (Array.isArray(group?.articles)
              ? group.articles
              : []
            ).map(article => {
              const articleId =
                getArticleId(article);
              const canonicalArticle =
                canonicalArticleById.get(
                  articleId
                );

              if (!canonicalArticle) {
                throw new Error(
                  `Clustering worker returned unknown article ${articleId}`
                );
              }

              return canonicalArticle;
            })
        }));

    autoMergedClusters =
      rebindWorkerGroups(
        clusteringResult
          .autoMergedClusters
      );
    ambiguousGroups =
      rebindWorkerGroups(
        clusteringResult
          .ambiguousGroups
      );
  }

  clusteringResult = null;

  if (typeof global.gc === 'function') {
    global.gc();
    const memory =
      process.memoryUsage();
    console.log(
      '[SMART MEMORY] post-clustering-gc',
      JSON.stringify({
        rssMB:
          Math.round(memory.rss / 1024 / 1024),
        heapUsedMB:
          Math.round(memory.heapUsed / 1024 / 1024),
        heapTotalMB:
          Math.round(memory.heapTotal / 1024 / 1024)
      })
    );
  }

  const ambiguousGroupCount = ambiguousGroups.length;
  let reviewGroups = prepareIncrementalReviewGroups(ambiguousGroups, autoMergedClusters);
  ambiguousGroups = null;
  metrics.ambiguousGroups = reviewGroups.length;
  metrics.fullGroupRepartitions = reviewGroups.filter(group => group.fullRepartition).length;
  attachSmartReviewProgress(reviewGroups, options, metrics, notify);

return { autoMergedClusters, reviewGroups, ambiguousGroupCount };
}
