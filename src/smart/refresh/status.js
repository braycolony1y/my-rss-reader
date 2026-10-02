import { SMART_NEWS_AI_CONFIG, SMART_REFRESH_MS } from '../config.js';
import { countSmartSources } from '../sources/normalize.js';
import { getEnabledVerificationProviders, providerEnabled } from '../verification/provider-config.js';
import { getProviderHealth } from '../verification/provider-health.js';

export function createSmartStatus({ db, getSources, hasGeminiKey, localModel, getProgress, isRunning }) {

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

    const providers =
      getEnabledVerificationProviders(
        hasGeminiKey()
      );

    const storedHealth =
      await getProviderHealth(db);

    const aiProviderHealth = {};

    for (
      const provider
      of SMART_NEWS_AI_CONFIG.providers
    ) {
      aiProviderHealth[
        provider.id
      ] = {
        providerId:
          provider.id,
        type:
          provider.type,
        model:
          provider.model,
        enabled:
          providerEnabled(
            provider,
            hasGeminiKey()
          ),
        status:
          providerEnabled(
            provider,
            hasGeminiKey()
          )
            ? (
              storedHealth[
                provider.id
              ]?.status ||
              'healthy'
            )
            : (
              provider.type ===
                'gemini' &&
                !hasGeminiKey()
                ? 'not_configured'
                : 'disabled'
            ),
        lastAttemptAt:
          storedHealth[
            provider.id
          ]?.lastAttemptAt ||
          null,
        lastSuccessAt:
          storedHealth[
            provider.id
          ]?.lastSuccessAt ||
          null,
        lastErrorAt:
          storedHealth[
            provider.id
          ]?.lastErrorAt ||
          null,
        lastErrorCode:
          storedHealth[
            provider.id
          ]?.lastErrorCode ||
          null,
        lastErrorMessage:
          storedHealth[
            provider.id
          ]?.lastErrorMessage ||
          null,
        consecutiveFailures:
          Number(
            storedHealth[
              provider.id
            ]
              ?.consecutiveFailures ||
            0
          )
      };
    }

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
        ),
      geminiConfigured:
        hasGeminiKey(),
      localConfigured:
        providers.some(
          provider =>
            provider.type ===
            'ollama'
        ),
      localModel,
      providerOrder:
        providers.map(
          provider =>
            provider.id
        ),
      aiProviderHealth,
      model:
        SMART_NEWS_AI_CONFIG
          .providers[0]
          .model
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
