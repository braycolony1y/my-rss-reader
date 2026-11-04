import { profileRouteParams, resolveProfileSelection } from '../../node_modules/@jackwener/opencli/dist/src/browser/profile.js';

// Configuration is loaded after provider imports. Resolve it when acquiring
// the page, and keep an explicit profile pinned for this persistent slot.
export function createGeminiWebPage(Page, slotId, {
    env = process.env,
    resolveProfile = resolveProfileSelection
} = {}) {
    const profile = [env.GEMINI_WEB_PROFILE, env.OPENCLI_BROWSER_PROFILE, env.OPENCLI_PROFILE]
        .map(value => value?.trim())
        .find(Boolean);
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
