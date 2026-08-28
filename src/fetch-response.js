export async function discardResponseBody(response) {
    if (!response || response.bodyUsed || !response.body) return false;

    try {
        if (typeof response.body.cancel === 'function') {
            await response.body.cancel();
            return true;
        }
        if (typeof response.body.destroy === 'function') {
            response.body.destroy();
            return true;
        }
        if (typeof response.body.resume === 'function') {
            response.body.resume();
            return true;
        }
    } catch (e) {
        // The body may already be locked by a consumer. In that case there is
        // nothing safe for this helper to do.
    }

    return false;
}

export function createTrackedFetch(fetchFn) {
    const responses = new Set();

    return {
        fetch: async (...args) => {
            const response = await fetchFn(...args);
            if (response) responses.add(response);
            return response;
        },
        discardUnread: async () => {
            const pending = [...responses];
            responses.clear();
            await Promise.allSettled(pending.map(discardResponseBody));
        }
    };
}
