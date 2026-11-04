export function readGeminiPageReadiness() {
    const composerReady = [...document.querySelectorAll('textarea,[contenteditable="true"]')]
        .some(element => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return !element.disabled && !element.readOnly
                && element.getAttribute('aria-disabled') !== 'true'
                && style.display !== 'none' && style.visibility !== 'hidden'
                && rect.width > 0 && rect.height > 0;
        });
    return { url: location.href, readyState: document.readyState, composerReady };
}

export async function waitForGeminiPageReady(page, { timeoutMs, sleep, providerError }) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const state = await page.evaluate(readGeminiPageReadiness).catch(() => null);
        if (state) {
            if (/accounts\.google\.com/i.test(state.url)) {
                return providerError(page, 'Gemini Web requires the Google account to be signed in', 'GEMINI_WEB_LOGIN_REQUIRED');
            }
            if (state.readyState !== 'loading' && state.composerReady) return state;
        }
        await sleep(300);
    }
    return providerError(page, 'Gemini Web did not become ready', 'GEMINI_WEB_PAGE_TIMEOUT');
}
