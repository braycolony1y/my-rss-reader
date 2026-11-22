import { DAY_MS, HOUR_MS } from '../config.js';
import { isSmartRefreshActive } from '../refresh/coordination.js';

const INITIAL_DELAY_MS = 5 * 60 * 1000;
const FAILURE_BACKOFF_MS = 6 * HOUR_MS;

// Module-level so repeated scheduler calls or overlapping ticks never run two
// evaluations at once.
let evaluationInFlight = false;
let nextAttemptAt = 0;

async function scheduleMonthlySourceEvaluation(
  db,
  getSources,
  {
    evaluate = null,
    initialDelayMs = INITIAL_DELAY_MS,
    intervalMs = HOUR_MS,
    now = () => Date.now()
  } = {}
) {
  const evaluateSourceReputations = evaluate || (
    await import('../../../summary-engine.js')
  ).evaluateSourceReputations;

  console.log(
    '[SMART EVAL] Monthly source evaluation scheduler initialized.'
  );

  const checkEvaluation = async () => {
    if (evaluationInFlight) return { status: 'busy' };
    if (now() < nextAttemptAt) return { status: 'backoff' };

    evaluationInFlight = true;
    try {
      const lastEvaluation = Number(
        (await db.get('lastSourceEvalTime', { type: 'json' })) || 0
      );
      const existingScores = await db.get('smartSourceScores', { type: 'json' });
      const startedAt = now();

      if (
        existingScores &&
        lastEvaluation &&
        startedAt - lastEvaluation <= 30 * DAY_MS
      ) {
        return { status: 'fresh' };
      }

      // Do not compete with a foreground refresh; the next tick retries.
      if (isSmartRefreshActive()) {
        return { status: 'deferred' };
      }

      const domains = [
        ...new Set(
          (await getSources()).map(source => source.domain).filter(Boolean)
        )
      ];

      if (!domains.length) return { status: 'no-sources' };

      console.log(
        `[SMART EVAL] Starting source reputation evaluation for ${domains.length} domains (gemini-web).`
      );

      const scores = await evaluateSourceReputations(domains);
      const scored = scores ? Object.keys(scores).length : 0;

      if (!scored) {
        nextAttemptAt = now() + FAILURE_BACKOFF_MS;
        console.error(
          `[SMART EVAL] Finished with failure: 0/${domains.length} sources scored; will retry after ${FAILURE_BACKOFF_MS / HOUR_MS}h.`
        );
        return { status: 'failed', scored: 0, failed: domains.length };
      }

      await db.put(
        'smartSourceScores',
        JSON.stringify({ ...(existingScores || {}), ...scores })
      );
      await db.put('lastSourceEvalTime', JSON.stringify(startedAt));

      const failed = domains.length - scored;
      console.log(
        `[SMART EVAL] Finished: ${scored} sources scored, ${failed} failed/missing, in ${Math.round((now() - startedAt) / 1000)}s.`
      );
      return { status: 'done', scored, failed };
    } catch (error) {
      nextAttemptAt = now() + FAILURE_BACKOFF_MS;
      console.error('[SMART EVAL] Evaluation failed:', error.message);
      return { status: 'error' };
    } finally {
      evaluationInFlight = false;
    }
  };

  const initialTimer = setTimeout(checkEvaluation, initialDelayMs);
  const recurringTimer = setInterval(checkEvaluation, intervalMs);
  if (initialTimer.unref) initialTimer.unref();
  if (recurringTimer.unref) recurringTimer.unref();

  return { checkEvaluation };
}

function resetSourceEvaluationStateForTests() {
  evaluationInFlight = false;
  nextAttemptAt = 0;
}

export { scheduleMonthlySourceEvaluation, resetSourceEvaluationStateForTests };
