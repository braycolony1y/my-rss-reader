export function geminiUnavailableError(keyManager, now = Date.now()) {
    const deadlines = (keyManager?.keys || [])
        .filter(key => key.status !== 'Error')
        .map(key => Number(key.cooldownUntil) || 0)
        .filter(until => until > now);
    const cooldownUntil = deadlines.length ? new Date(Math.min(...deadlines)).toISOString() : null;
    const error = new Error(cooldownUntil
        ? `Gemini API cooldown active until ${cooldownUntil}`
        : 'No Gemini API key is currently available');
    error.code = cooldownUntil ? 'GEMINI_COOLDOWN' : 'NOT_CONFIGURED';
    error.cooldownUntil = cooldownUntil;
    // No provider request happened; let the caller continue its fallback chain.
    error.skipProvider = true;
    error.nonProviderFault = true;
    return error;
}

export async function acquireGeminiKey(keyManager, rateIntervalMs) {
    if (!keyManager?.getCurrentKeyObj?.()?.key) throw geminiUnavailableError(keyManager);
    await keyManager.waitForRateSlot?.(rateIntervalMs);
    // Other jobs may consume the remaining quota while this job is waiting.
    const keyObject = keyManager.getCurrentKeyObj();
    if (!keyObject?.key) throw geminiUnavailableError(keyManager);
    return keyObject;
}
