import { DAY_MS, HOUR_MS } from '../config.js';
import { isSmartRefreshActive } from '../refresh/coordination.js';

const INITIAL_DELAY_MS = 5 * 60 * 1000;
const FAILURE_BACKOFF_MS = 6 * HOUR_MS;

// Module-level so repeated scheduler calls or overlapping ticks never run two
// evaluations at once.
let evaluationInFlight = false;
let nextAttemptAt = 0;

// A foreground refresh normally wins, but a busy host must not postpone the monthly evaluation
// forever: after this many consecutive deferrals (hourly ticks, ~2 days) or this long since the
// first deferral, the evaluation runs anyway. It stays single-flight and never blocks a refresh.
const MAX_CONSECUTIVE_DEFERRALS = 48;
const MAX_DEFERRED_MS = 2 * DAY_MS;
// A run only counts as the monthly full run when at least this share of sources scored.
const MIN_COVERAGE = 0.8;
let deferrals = 0;
let firstDeferredAt = 0;
// Domains scored so far in the current (not yet stamped) evaluation cycle; partial runs retry only the rest.
let cycleScored = new Set();

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
        if (!deferrals) firstDeferredAt = startedAt;
        deferrals++;
        const overdue = deferrals > MAX_CONSECUTIVE_DEFERRALS || startedAt - firstDeferredAt > MAX_DEFERRED_MS;
        if (!overdue) {
          console.log(`[SMART EVAL] Deferred: a foreground smart refresh is active (${deferrals}/${MAX_CONSECUTIVE_DEFERRALS}).`);
          return { status: 'deferred', deferrals };
        }
        console.log(`[SMART EVAL] Running despite an active refresh after ${deferrals} deferrals.`);
      }
      deferrals = 0;
      firstDeferredAt = 0;

      const domains = [
        ...new Set(
          (await getSources()).map(source => source.domain).filter(Boolean)
        )
      ];

      if (!domains.length) return { status: 'no-sources' };

      console.log(
        `[SMART EVAL] Starting source reputation evaluation for ${domains.length} domains (gemini-web).`
      );

      const domainSet = new Set(domains);
      const pending = domains.filter(domain => !cycleScored.has(domain));
      const scores = (await evaluateSourceReputations(pending)) || {};
      const scoredNow = Object.keys(scores).filter(domain => domainSet.has(domain));
      const scored = scoredNow.length;

      if (!scored) {
        nextAttemptAt = now() + FAILURE_BACKOFF_MS;
        console.error(
          `[SMART EVAL] Finished with failure: 0/${pending.length} sources scored; will retry after ${FAILURE_BACKOFF_MS / HOUR_MS}h.`
        );
        return { status: 'failed', scored: 0, failed: pending.length };
      }

      for (const domain of scoredNow) cycleScored.add(domain);
      await db.put(
        'smartSourceScores',
        JSON.stringify({ ...(existingScores || {}), ...scores })
      );

      const coverage = cycleScored.size / domains.length;
      const failed = domains.length - cycleScored.size;
      const seconds = Math.round((now() - startedAt) / 1000);
      if (coverage < MIN_COVERAGE) {
        // Keep what scored, but do not claim a full run: the missing domains retry after the backoff.
        nextAttemptAt = now() + FAILURE_BACKOFF_MS;
        console.warn(
          `[SMART EVAL] Finished partially: ${cycleScored.size}/${domains.length} sources scored (${Math.round(coverage * 100)}% < ${MIN_COVERAGE * 100}%), ${failed} missing retry after ${FAILURE_BACKOFF_MS / HOUR_MS}h, in ${seconds}s.`
        );
        return { status: 'partial', scored, failed, coverage };
      }

      await db.put('lastSourceEvalTime', JSON.stringify(startedAt));
      cycleScored = new Set();
      console.log(
        `[SMART EVAL] Finished: ${domains.length - failed}/${domains.length} sources scored (${Math.round(coverage * 100)}% coverage), ${failed} failed/missing, in ${seconds}s.`
      );
      return { status: 'done', scored, failed, coverage };
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
  deferrals = 0;
  firstDeferredAt = 0;
  cycleScored = new Set();
}

export { scheduleMonthlySourceEvaluation, resetSourceEvaluationStateForTests };
