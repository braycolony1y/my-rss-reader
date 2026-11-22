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

// Read decoded stream bytes, not just Content-Length (which may describe a
// compressed body). Cancel oversized/failed streams so sockets are released.
export async function readResponseBytes(response, { maxBytes = 8 * 1024 * 1024 } = {}) {
    if (Number(response.headers?.get('content-length')) > maxBytes) {
        await discardResponseBody(response);
        throw Object.assign(new Error('Response exceeds size limit'),{code:'RESPONSE_TOO_LARGE'});
    }
    if (!response.body) {
        // Lightweight adapters/test doubles without a stream still get a bound.
        const buffer=Buffer.from(response.arrayBuffer?await response.arrayBuffer():await response.text());
        if(buffer.length>maxBytes)throw Object.assign(new Error('Response exceeds size limit'),{code:'RESPONSE_TOO_LARGE'});
        return buffer;
    }
    const chunks=[];let bytes=0;
    try {
        for await (const chunk of response.body) {
            const buffer=Buffer.from(chunk);bytes+=buffer.length;
            if(bytes>maxBytes)throw Object.assign(new Error('Response exceeds size limit'),{code:'RESPONSE_TOO_LARGE'});
            chunks.push(buffer);
        }
        return Buffer.concat(chunks,bytes);
    } finally { await discardResponseBody(response); }
}
export async function readResponseText(response, options) {
    return (await readResponseBytes(response,options)).toString('utf8');
}
