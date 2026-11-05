import assert from 'node:assert/strict';
import {rssSourceCooldown as sourceCooldown} from '../../src/articles/source-cooldown.js';

export async function verifyManualRefreshHttp(request, feedUrl) {
    await sourceCooldown.record(feedUrl, Error('Publisher verification HTTP 403'));
    const previous = await sourceCooldown.inspect(feedUrl);
    const fetch = globalThis.fetch;
    try {
        globalThis.fetch = (url, options) => String(url) === feedUrl
            ? Promise.resolve(new Response('Verification required', {status: 429, headers: {'Retry-After': '600'}}))
            : fetch(url, options);
        const failed = await request('/api/sync', {method: 'POST', body: {feedUrl, requestId: 'manual-blocked'}});
        assert.ok(failed.data.logs.length > 0);
        assert.ok(failed.data.logs.some(entry => /HTTP 429/.test(entry.Issue)), 'manual retry reaches the publisher');
        const {remainingMs: oldRemaining, ...before} = previous;
        const {remainingMs, ...after} = await sourceCooldown.inspect(feedUrl);
        assert.deepEqual(after, before);
        assert.ok(remainingMs > 0 && remainingMs <= oldRemaining);
    } finally {globalThis.fetch = fetch;}
    const successful = await request('/api/sync', {method: 'POST', body: {feedUrl, requestId: 'manual-recovered'}});
    assert.deepEqual(successful.data.logs, []);
    assert.equal(sourceCooldown.get(feedUrl).strikes, undefined);
}
