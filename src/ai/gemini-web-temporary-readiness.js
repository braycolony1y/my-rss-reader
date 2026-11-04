export async function waitForGeminiTemporaryChatState(page, expectedEnabled, {
    timeoutMs, readState, sleep, providerError
}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const state = await readState(page);
        const confirmed = state?.found && state.knownState && state.enabled === expectedEnabled
            && (!expectedEnabled || (state.activeTemporaryDom && state.iconName === 'close'));
        if (confirmed) return state;
        await sleep(200);
    }
    return providerError(page,
        expectedEnabled ? 'Temporary Chat could not be confirmed ON' : 'Temporary Chat could not be confirmed OFF',
        expectedEnabled ? 'GEMINI_WEB_TEMP_CHAT_NOT_CONFIRMED' : 'GEMINI_WEB_TEMP_CHAT_RESET_FAILED');
}
