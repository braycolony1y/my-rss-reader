// Temporary Chat ON is confirmed by the authoritative label ("Turn off
// temporary chat") or, for older UIs, by the active DOM plus the close icon.
// Ambiguous (contradictory) readings never confirm.
export function isTemporaryChatConfirmedOn(state) {
    return Boolean(
        state && state.enabled && !state.ambiguous &&
        (state.labelState === 'on' ||
            (state.activeTemporaryDom && state.iconName === 'close'))
    );
}

export async function waitForGeminiTemporaryChatState(page, expectedEnabled, {
    timeoutMs, readState, sleep, providerError
}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const state = await readState(page);
        const confirmed = state?.found && state.knownState && !state.ambiguous
            && state.enabled === expectedEnabled
            && (!expectedEnabled || isTemporaryChatConfirmedOn(state));
        if (confirmed) return state;
        await sleep(100);
    }
    return providerError(page,
        expectedEnabled ? 'Temporary Chat could not be confirmed ON' : 'Temporary Chat could not be confirmed OFF',
        expectedEnabled ? 'GEMINI_WEB_TEMP_CHAT_NOT_CONFIRMED' : 'GEMINI_WEB_TEMP_CHAT_RESET_FAILED');
}
