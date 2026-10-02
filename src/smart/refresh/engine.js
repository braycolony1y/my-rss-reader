import { getClusterWorker } from '../clustering/worker-client.js';
import { SMART_NEWS_AI_CONFIG } from '../config.js';
import { createSmartSettings } from '../persistence/settings.js';
import { createSmartSourceDiscovery } from '../sources/discovery.js';
import { createSmartSourceSettings } from '../sources/settings.js';
import { createSmartRefresh } from './run.js';
import { createSmartSchedule } from './schedule.js';
import { createSmartStatus } from './status.js';

export function createSmartNewsEngine({ db, helpers, headers = {}, geminiKeyManager = null, clusterWorkerFactory = getClusterWorker }) {
  const staticGeminiKey =
    process.env.GEMINI_API_KEY ||
    '';

  const staticKeyObject =
    staticGeminiKey
      ? {
        key:
          staticGeminiKey,
        index: 0
      }
      : null;

  const keyManager =
    geminiKeyManager || {
      keys:
        staticKeyObject
          ? [staticKeyObject]
          : [],

      getCurrentKeyObj:
        () =>
          staticKeyObject,

      recordUsage:
        () => { },

      reportError:
        () => { }
    };

  const hasGeminiKey =
    () =>
      Boolean(
        keyManager
          ?.getCurrentKeyObj?.()
          ?.key
      );

  const localModel =
    SMART_NEWS_AI_CONFIG
      .providers
      .find(
        provider =>
          provider.id ===
          'local-qwen'
      )?.model ||
    'qwen2.5:3b';

  const { getSettings, updateSettings } = createSmartSettings({ db });
  const {
    getSourceSettings, getSources, addSource, setSourceEnabled, removeSource,
    setSourceFetchMethodsByIdentity, setSourceFetchMethods, resetSources
  } = createSmartSourceSettings({ db, getSettings });
  const { discoverSources } = createSmartSourceDiscovery({ db, getSourceSettings });
  const { sync, getProgress, isRunning } = createSmartRefresh({
    db, helpers, headers, keyManager, hasGeminiKey, localModel, getSources,
    getSettings, setStatus: value => setStatus(value), clusterWorkerFactory
  });
  const { getStatus, setStatus } = createSmartStatus({
    db, getSources, hasGeminiKey, localModel, getProgress, isRunning
  });
  const { start } = createSmartSchedule({ helpers, sync, getSources, hasGeminiKey });

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
