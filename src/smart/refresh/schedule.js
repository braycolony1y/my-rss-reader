import { SMART_REFRESH_MS } from '../config.js';

export function createSmartSchedule({ helpers, sync, getSources }) {
  let timer = null;
  function scheduleNext() {
    clearTimeout(timer);

    timer = setTimeout(
      async () => {
        if (typeof helpers.waitForHttpIdle === 'function') {
          await helpers.waitForHttpIdle();
        }
        await sync();
        scheduleNext();
      },
      SMART_REFRESH_MS
    );

    if (timer.unref) {
      timer.unref();
    }
  }

  function start() {
    const initial =
      setTimeout(
        async () => {
          if (typeof helpers.waitForHttpIdle === 'function') {
            await helpers.waitForHttpIdle();
          }
          await sync();
        },
        2500
      );

    if (initial.unref) {
      initial.unref();
    }

    scheduleNext();

    getSources()
      .then(sources =>
        console.log(
          '[SMART] Engine initialized with',
          sources.length,
          'sources'
        )
      )
      .catch(error =>
        console.error(
          '[SMART] Could not load source settings:',
          error.message
        )
      );
  }

  return { scheduleNext, start };
}
