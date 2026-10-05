import { sourceWorkView } from '../prefilter/source-work.js';
import { hasWorkerHeadroom } from '../../observability/memory-budget.js';
import { beginSmartRefresh, endSmartRefresh, isSmartRefreshActive } from '../refresh/coordination.js';
import { sleep } from '../refresh/scheduling.js';
import { fetchInBatches, fetchSmartSource, prefetchOpenCliOnlySmartArticles } from '../sources/fetch.js';

async function startSmartSyncLoop(
  helpers,
  headers,
  db,
  getSources
) {
  console.log(
    '🚀 [SMART SYNC] Background smart source fetch loop initialized.'
  );

  // The engine schedules its first clustering refresh shortly after startup.
  // Give that refresh first claim on memory instead of racing it with another
  // full source snapshot.
  await sleep(10_000);

  while (true) {
    if (isSmartRefreshActive() || !hasWorkerHeadroom(768)) {
      console.log(
        '[SMART SYNC] Foreground Smart refresh active; background source fetch deferred.'
      );
      await sleep(30_000);
      continue;
    }
    const cycleStartedAt =
      Date.now();

    try {
      if (typeof helpers.waitForHttpIdle === 'function') {
        await helpers.waitForHttpIdle();
      }
      if (isSmartRefreshActive()) {
        await sleep(15_000);
        continue;
      }
      const configuredSources =
        await getSources();

      const uniqueSources =
        [
          ...new Map(
            configuredSources.map(
              source => [
                source.url,
                source
              ]
            )
          ).values()
        ];

      const results =
        await fetchInBatches(
          uniqueSources,
          3,
          source =>
            fetchSmartSource(
              source,
              helpers.fastParseRSS,
              headers
            )
        );

      if (isSmartRefreshActive()) {
        console.log(
          '[SMART SYNC] Foreground Smart refresh started during background fetch; dropping duplicate batch.'
        );
        continue;
      }

      const sourceWork = await sourceWorkView(db, results, configuredSources);

      if (
        typeof helpers
          .resolveSmartArticleDestinations ===
        'function'
      ) {
        await helpers
          .resolveSmartArticleDestinations(
            sourceWork
          );
      }

      const articles =
        results.flatMap(
          result =>
            result.articles ||
            []
        );

      await helpers.observeCacheArticles?.(articles);
      void prefetchOpenCliOnlySmartArticles(
        sourceWork,
        helpers
      ).catch(error => console.warn('[SMART PREFETCH]', error.message));

      await db.put(
        'smartRawArticles',
        JSON.stringify(articles)
      );

      console.log(
        `[SMART SYNC] Fetched ${articles.length} articles from ${uniqueSources.length} sources.`
      );
    } catch (error) {
      console.error(
        '[SMART SYNC] Background fetch failed:',
        error.message
      );
    }

    const minimumCycleTime =
      15 * 60 * 1000;

    const elapsed =
      Date.now() -
      cycleStartedAt;

    if (
      elapsed <
      minimumCycleTime
    ) {
      await sleep(
        minimumCycleTime -
        elapsed
      );
    }
  }
}

export { startSmartSyncLoop };
