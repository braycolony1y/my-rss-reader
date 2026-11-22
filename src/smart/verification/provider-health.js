import { sanitizeProviderErrorMessage, normalizeProviderError } from './diagnostics.js';

let providerHealthWriteChain = Promise.resolve();

async function getProviderHealth(db) {
  try {
    return (
      await db.get(
        'smartAiProviderHealth',
        {
          type: 'json'
        }
      )
    ) || {};
  } catch {
    return {};
  }
}

async function updateProviderHealth(
  db,
  provider,
  updater
) {
  providerHealthWriteChain =
    providerHealthWriteChain.then(
      async () => {
        const state =
          await getProviderHealth(db);

        const existing =
          state[provider.id] || {
            providerId:
              provider.id,
            type:
              provider.type,
            model:
              provider.model,
            enabled: true,
            status: 'healthy',
            lastAttemptAt: null,
            lastSuccessAt: null,
            lastErrorAt: null,
            lastErrorCode: null,
            lastErrorMessage:
              null,
            consecutiveFailures:
              0
          };

        const next =
          typeof updater ===
            'function'
            ? updater({
              ...existing
            })
            : {
              ...existing,
              ...updater
            };

        state[provider.id] = {
          ...existing,
          ...next,
          providerId:
            provider.id,
          type:
            provider.type,
          model:
            provider.model
        };

        await db.put(
          'smartAiProviderHealth',
          JSON.stringify(state)
        );
      }
    );

  try {
    await providerHealthWriteChain;
  } catch (error) {
    console.error(
      '[SMART] Failed to update provider health:',
      error.message
    );
  }
}

async function recordProviderAttempt(
  db,
  provider
) {
  await updateProviderHealth(
    db,
    provider,
    existing => ({
      ...existing,
      enabled: true,
      lastAttemptAt:
        new Date().toISOString()
    })
  );
}

async function recordProviderSuccess(
  db,
  provider
) {
  await updateProviderHealth(
    db,
    provider,
    existing => ({
      ...existing,
      status: 'healthy',
      lastSuccessAt:
        new Date().toISOString(),
      consecutiveFailures: 0,
      cooldownUntil: null,
      cooldownCode: null,
      cooldownReason: null
    })
  );
}

async function recordProviderCooldown(
  db,
  provider,
  error
) {
  const rawUntil =
    error?.retryAt ??
    error?.cooldownUntil ??
    null;

  const timestamp =
    Number(rawUntil) ||
    (
      rawUntil
        ? Date.parse(rawUntil)
        : 0
    );

  const cooldownUntil =
    Number.isFinite(timestamp) &&
    timestamp > 0
      ? new Date(timestamp)
          .toISOString()
      : null;

  await updateProviderHealth(
    db,
    provider,
    existing => ({
      ...existing,

      state:
        'cooldown',

      status:
        'cooldown',

      lastAttemptAt:
        new Date().toISOString(),

      cooldownUntil,

      cooldownCode:
        String(
          error?.code ||
          'PROVIDER_COOLDOWN'
        ),

      cooldownReason:
        sanitizeProviderErrorMessage(
          error?.message ||
          'Provider cooldown is active'
        )
    })
  );
}

async function recordProviderError(
  db,
  provider,
  error
) {
  const normalized =
    normalizeProviderError(error);

  await updateProviderHealth(
    db,
    provider,
    existing => {
      const failures =
        Number(
          existing
            .consecutiveFailures ||
          0
        ) + 1;

      return {
        ...existing,
        status:
          failures >= 3
            ? 'unavailable'
            : 'degraded',
        lastErrorAt:
          new Date().toISOString(),
        lastErrorCode:
          normalized.code,
        lastErrorMessage:
          normalized.message,
        consecutiveFailures:
          failures
      };
    }
  );
}

export { getProviderHealth, recordProviderAttempt, recordProviderSuccess, recordProviderCooldown, recordProviderError };
