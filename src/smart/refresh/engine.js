import { getClusterWorker } from '../clustering/worker-client.js';
import { createSmartSettings } from '../persistence/settings.js';
import { createSmartSourceDiscovery } from '../sources/discovery.js';
import { createSmartSourceSettings } from '../sources/settings.js';
import { createSmartRefresh } from './run.js';
import { createSmartSchedule } from './schedule.js';
import { createSmartStatus } from './status.js';

export function createSmartNewsEngine({ db, helpers, headers = {}, clusterWorkerFactory = getClusterWorker }) {
  const { getSettings, updateSettings } = createSmartSettings({ db });
  const {
    getSourceSettings, getSources, addSource, setSourceEnabled, removeSource,
    setSourceFetchMethodsByIdentity, setSourceFetchMethods, resetSources
  } = createSmartSourceSettings({ db, getSettings });
  const { discoverSources } = createSmartSourceDiscovery({ db, getSourceSettings });
  const { sync, getProgress, isRunning } = createSmartRefresh({
    db, helpers, headers, getSources,
    getSettings, setStatus: value => setStatus(value), clusterWorkerFactory
  });
  const { getStatus, setStatus } = createSmartStatus({
    db, getSources, getProgress, isRunning
  });
  const { start } = createSmartSchedule({ helpers, sync, getSources });

  return {
    getStatus,
    getSources,
    getSourceSettings,
    addSource,
    removeSource,
    setSourceEnabled,
    setSourceFetchMethods,
    setSourceFetchMethodsByIdentity,
    discoverSources,
    resetSources,
    sync,
    start,
    getSettings,
    updateSettings
  };
}
