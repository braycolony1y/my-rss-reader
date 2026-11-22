import { SMART_REFRESH_MS } from '../config.js';
import { countSmartSources } from '../sources/normalize.js';

export function createSmartStatus({ db, getSources, getProgress, isRunning }) {

  async function getStatus() {
    const stored =
      (
        await db.get(
          'smartStatus',
          {
            type: 'json'
          }
        )
      ) || {};

    const sources =
      await getSources();

    return {
      ...stored,
      cumulativeClusteringCounters: (await db.get('smartClusteringCounters', { type: 'json' })) || {},
      running: isRunning(),
      progress:
        getProgress(),
      refreshMinutes:
        SMART_REFRESH_MS /
        60000,
      configuredSourceCount:
        sources.length,
      sourceCounts:
        countSmartSources(
          sources
        )
    };
  }

  async function setStatus(value) {
    await db.put(
      'smartStatus',
      JSON.stringify(value)
    );
  }

  return { getStatus, setStatus };
}
