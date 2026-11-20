import { profileRouteParams, resolveProfileSelection } from '../../node_modules/@jackwener/opencli/dist/src/browser/profile.js';

export function geminiWebProfileName(env = process.env) {
    return [env.GEMINI_WEB_PROFILE, env.OPENCLI_BROWSER_PROFILE, env.OPENCLI_PROFILE]
        .map(value => value?.trim())
        .find(Boolean);
}

// Concrete profile id this provider is pinned to (undefined = automatic routing).
export function resolveGeminiWebProfileId(env = process.env, resolveProfile = resolveProfileSelection) {
    const routing = profileRouteParams(resolveProfile(geminiWebProfileName(env)));
    return routing.contextId || routing.preferredContextId;
}

// Configuration is loaded after provider imports. Resolve it when acquiring
// the page, and keep an explicit profile pinned for this persistent slot.
export function createGeminiWebPage(Page, slotId, {
    env = process.env,
    resolveProfile = resolveProfileSelection
} = {}) {
    const profile = geminiWebProfileName(env);
    const routing = profileRouteParams(resolveProfile(profile));

    return new Page(
        `rss-gemini-web-${slotId}`,
        -1,
        routing.contextId,
        'background',
        'browser',
        'persistent',
        routing.preferredContextId
    );
}
