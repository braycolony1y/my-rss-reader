// Model availability can settle after Gemini's temporary-chat transition.
// Wait only for the requested model; never click disabled or upgrade options.
export async function waitForGeminiWebModel({
    readState, openMenu, matches, sleep, timeoutMs = 8000, now = Date.now
}) {
    const deadline = now() + timeoutMs;
    for (;;) {
        await openMenu();
        const state = await readState();
        const model = state.models.find(matches);
        if ((model && !model.disabled) || model?.upsell || now() >= deadline) {
            return { state, model };
        }
        await sleep(Math.min(200, Math.max(0, deadline - now())));
    }
}
