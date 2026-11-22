import { DAY_MS, HOUR_MS } from '../config.js';

async function scheduleMonthlySourceEvaluation(
  db,
  getSources
) {
  const {
    evaluateSourceReputations
  } = await import(
    '../../../summary-engine.js'
  );

  console.log(
    '🚀 [SMART EVAL] Monthly source evaluation scheduler initialized.'
  );

  const checkEvaluation =
    async () => {
      try {
        const lastEvaluation =
          (
            await db.get(
              'lastSourceEvalTime',
              {
                type: 'json'
              }
            )
          ) || 0;

        const existingScores =
          await db.get(
            'smartSourceScores',
            {
              type: 'json'
            }
          );

        const now = Date.now();

        if (
          !existingScores ||
          now -
          Number(
            lastEvaluation
          ) >
          30 * DAY_MS
        ) {
          const sources =
            await getSources();

          const domains =
            [
              ...new Set(
                sources
                  .map(
                    source =>
                      source.domain
                  )
                  .filter(
                    Boolean
                  )
              )
            ];

          const scores =
            await evaluateSourceReputations(
              domains
            );

          if (
            scores &&
            typeof scores ===
            'object' &&
            Object.keys(scores)
              .length
          ) {
            await db.put(
              'smartSourceScores',
              JSON.stringify(
                scores
              )
            );

            await db.put(
              'lastSourceEvalTime',
              JSON.stringify(
                now
              )
            );

            console.log(
              '[SMART EVAL] Source reputation evaluation completed.'
            );
          }
        }
      } catch (error) {
        console.error(
          '[SMART EVAL] Evaluation failed:',
          error.message
        );
      }
    };

  const initialTimer =
    setTimeout(
      checkEvaluation,
      10_000
    );

  const recurringTimer =
    setInterval(
      checkEvaluation,
      HOUR_MS
    );

  if (initialTimer.unref) {
    initialTimer.unref();
  }

  if (recurringTimer.unref) {
    recurringTimer.unref();
  }
}

export { scheduleMonthlySourceEvaluation };
