import { sourceCooldown } from './source-cooldown.js';
import { readPublisherResponse, assertNoPublisherVerification } from './publisher-verification.js';

// A proxy URL carries the publisher in its url parameter/path, not its host.
function publisherUrl(value) {
    const url = new URL(value);
    const nested = url.searchParams.get('url');
    if (nested && /^https?:\/\//.test(nested)) return nested;
    if (url.hostname === 'r.jina.ai') return value.slice(value.indexOf('/', value.indexOf('://') + 3) + 1);
    return value;
}

export async function backgroundPublisherFetch(url, options) {
    return sourceCooldown.run(publisherUrl(url), async () => {
        const response = await globalThis.fetch(url, options);
        const body = await readPublisherResponse(response);
        return new Response([204, 205, 304].includes(response.status) ? null : body, {
            status: response.status, statusText: response.statusText, headers: response.headers
        });
    }, { lane: 'p3' });
}

export function backgroundPublisherCommand(url, execute, ...args) {
    return sourceCooldown.run(url, async () => {
        const result = await execute(...args);
        assertNoPublisherVerification(result.stdout);
        return result;
    });
}
