import { createConcurrencyLimiter } from '../runtime/concurrency-limiter.js';
import { decodeHTMLEntities } from '../../feed-parsers.js';

export function googleNewsArticleId(value) {
    try {
        const url = new URL(value);
        return url.hostname === 'news.google.com'
            ? url.pathname.match(/^\/(?:rss\/)?(?:articles|read)\/([A-Za-z0-9_-]+)\/?$/)?.[1] || '' : '';
    } catch { return ''; }
}

export function cleanGoogleNewsDestination(value) {
    try {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
        const host = url.hostname.toLowerCase().replace(/\.$/, '');
        if (/(^|\.)google\.(?:com|[a-z]{2}|com\.[a-z]{2}|co\.[a-z]{2})$/.test(host)
            || ['googleusercontent.com', 'gstatic.com', 'googleapis.com', 'googleweblight.com',
                'youtube.com', 'youtu.be', 'doubleclick.net', 'googlesyndication.com', 'googleadservices.com']
                .some(domain => host === domain || host.endsWith('.' + domain))) return '';
        // Preserve signed/encoded publisher values byte for byte. URLSearchParams
        // would rewrite spaces, escapes and punctuation in unrelated parameters.
        const source = String(value).trim().replace(/#.*$/, '');
        const queryAt = source.indexOf('?');
        if (queryAt < 0) return source;
        const kept = source.slice(queryAt + 1).split('&').filter(part => {
            let key = part.split('=', 1)[0];
            try { key = decodeURIComponent(key.replace(/\+/g, ' ')); } catch { }
            return !/^(?:utm_.+|gclid|dclid|gclsrc|_ga|_gl|gbraid|wbraid)$/i.test(key);
        });
        return source.slice(0, queryAt) + (kept.length ? '?' + kept.join('&') : '');
    } catch { return ''; }
}

// These are valid HTTP destinations which the reader deliberately does not
// support. A browser cannot turn them into a supported publisher article.
export function isRejectedGoogleNewsDestination(value) {
    try {
        const url = new URL(value);
        return ['http:', 'https:'].includes(url.protocol) && !googleNewsArticleId(value)
            && !cleanGoogleNewsDestination(value);
    } catch { return false; }
}

// Old IDs are protobuf envelopes, with the publisher URL in a length-delimited
// field. Read varints (including lengths >127), rather than slicing fixed bytes.
export function decodeGoogleNewsOffline(value, { raw = false } = {}) {
    const id = googleNewsArticleId(value);
    if (!id || id.length > 16384) return '';
    const bytes = Buffer.from(id, 'base64url');
    let offset = 0;
    const varint = () => {
        let value = 0, multiplier = 1;
        for (let i = 0; i < 8 && offset < bytes.length; i++) {
            const byte = bytes[offset++]; value += (byte & 127) * multiplier;
            if (!(byte & 128)) return value;
            multiplier *= 128;
        }
        throw Error('Invalid protobuf varint');
    };
    try {
        while (offset < bytes.length) {
            const tag = varint();
            if (!tag) return '';
            switch (tag % 8) {
                case 0: varint(); break;
                case 1: offset += 8; break;
                case 5: offset += 4; break;
                case 2: {
                    const length = varint();
                    if (offset + length > bytes.length) return '';
                    const text = bytes.subarray(offset, offset + length).toString('utf8');
                    offset += length;
                    if (/^https?:\/\//i.test(text)) return raw ? text : cleanGoogleNewsDestination(text);
                    break;
                }
                default: return '';
            }
        }
    } catch { }
    return '';
}

const context = [['en-US', 'US', ['FINANCE_TOP_INDICES', 'WEB_TEST_1_0_0'], null, null, 1, 1, 'US:en', null, 180, null, null, null, null, null, 0, null, null, [1608992183, 723341000]], 'en-US', 'US', 1, [2, 3, 4, 8], 1, 0, '655000234', 0, 0, null, 0];

// The npm decoder's batchexecute protocol, with abortable IO, shared metadata,
// explicit response IDs, and a single paced network lane for RSS and Smart sync.
export function createGoogleNewsDecoder({ fetchImpl = (...args) => fetch(...args), headers = {},
    timeoutMs = 10000, intervalMs = 700, now = Date.now, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
    const limiter = createConcurrencyLimiter(1, { maxPending: 64 });
    const metadata = new Map();
    let blockedUntil = 0, lastStart = -Infinity, sequence = 0;
    let queue = [], flushing = false;
    async function request(url, options = {}) {
        return limiter.run(async () => {
            if (now() < blockedUntil) throw Error('Google News HTTP 429 backoff active');
            const delay = intervalMs - (now() - lastStart);
            if (delay > 0) await sleep(delay);
            if (now() < blockedUntil) throw Error('Google News HTTP 429 backoff active');
            lastStart = now();
            const response = await fetchImpl(url, { ...options, headers: { ...headers, ...options.headers }, signal: AbortSignal.timeout(timeoutMs) });
            if (!response.ok) {
                if (response.status === 429) {
                    const retry = response.headers?.get('retry-after');
                    const duration = /^\d+$/.test(retry || '') ? Number(retry) * 1000 : Date.parse(retry || '') - now();
                    blockedUntil = now() + Math.max(120000, Number.isFinite(duration) ? duration : 0);
                }
                await response.body?.cancel();
                throw Error('Google News HTTP ' + response.status);
            }
            return { url: response.url, text: await response.text() };
        });
    }
    function parameters(sourceUrl) {
        const id = googleNewsArticleId(sourceUrl);
        if (!id) return Promise.reject(Error('Invalid Google News article ID'));
        const cached = metadata.get(id);
        if (cached && now() - cached.at < 300000) return cached.promise;
        const promise = (async () => {
            const page = await request('https://news.google.com/articles/' + id);
            const destination = cleanGoogleNewsDestination(page.url);
            if (destination) return { destination };
            if (isRejectedGoogleNewsDestination(page.url)) return { permanentFailure: true };
            const attr = name => decodeHTMLEntities(page.text.match(new RegExp('\\s' + name + '=["\']([^"\']+)["\']', 'i'))?.[1] || '');
            const timestamp = attr('data-n-a-ts'), signature = attr('data-n-a-sg');
            if (!/^\d+$/.test(timestamp) || !signature) throw Error('Google News destination metadata unavailable');
            return { id, timestamp: Number(timestamp), signature };
        })();
        metadata.set(id, { at: now(), promise });
        promise.catch(() => metadata.delete(id));
        if (metadata.size > 256) metadata.delete(metadata.keys().next().value);
        return promise;
    }
    async function rpc(items) {
        const rows = items.map(item => ['Fbv4je', JSON.stringify(['garturlreq', context, item.params.id, item.params.timestamp, item.params.signature]), null, item.tag]);
        const response = await request('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
            body: new URLSearchParams({ 'f.req': JSON.stringify([rows]) })
        });
        const found = new Map();
        const visit = node => {
            if (!Array.isArray(node)) return;
            if (['wrb.fr', 'w779db'].includes(node[0]) && node[1] === 'Fbv4je') {
                try {
                    const data = JSON.parse(node[2]);
                    const destination = data[0] === 'garturlres' ? cleanGoogleNewsDestination(data[1]) : '';
                    const tag = items.length === 1 ? items[0].tag : node[6];
                    if (destination && items.some(item => item.tag === tag)) found.set(tag, destination);
                    else if (data[0] === 'garturlres' && isRejectedGoogleNewsDestination(data[1]) && items.some(item => item.tag === tag)) found.set(tag, { permanentFailure: true });
                } catch { }
            } else for (const child of node) visit(child);
        };
        for (const line of response.text.split(/\r?\n/)) {
            if (!line.trim().startsWith('[')) continue;
            try { visit(JSON.parse(line)); } catch { }
        }
        return found;
    }
    async function flush() {
        try {
            while (queue.length) {
                const batch = queue.splice(0, 8), ready = [];
                for (const item of batch) {
                    try {
                        item.params = await parameters(item.url);
                        if (item.params.permanentFailure) item.resolve({ status: false, permanentFailure: true });
                        else if (item.params.destination) item.resolve({ status: true, decoded_url: item.params.destination });
                        else ready.push(item);
                    } catch (error) { item.resolve({ status: false, message: error.message }); }
                }
                if (!ready.length) continue;
                try {
                    const results = await rpc(ready);
                    let singleRetries = 0;
                    for (const item of ready) {
                        // Never associate a batch by response order. If a server
                        // omits correlation IDs, reuse metadata in a single RPC.
                        const destination = results.get(item.tag) || (ready.length > 1 && singleRetries++ < 2 ? (await rpc([item])).get(item.tag) : '');
                        item.resolve(destination?.permanentFailure ? { status: false, permanentFailure: true }
                            : destination ? { status: true, decoded_url: destination } : { status: false, message: 'Google News did not return a publisher destination' });
                    }
                } catch (error) { for (const item of ready) item.resolve({ status: false, message: error.message }); }
            }
        } finally { flushing = false; }
    }
    function decode(url) {
        const offline = decodeGoogleNewsOffline(url);
        if (offline) return Promise.resolve({ status: true, decoded_url: offline });
        if (isRejectedGoogleNewsDestination(decodeGoogleNewsOffline(url, { raw: true }))) return Promise.resolve({ status: false, permanentFailure: true });
        return new Promise(resolve => {
            if (queue.length >= 64) return resolve({ status: false, message: 'Google News decode queue full' });
            queue.push({ url, resolve, tag: String(++sequence) });
            if (!flushing) { flushing = true; setImmediate(flush); }
        });
    }
    return { decode, decodeBatch: urls => Promise.all(urls.map(async source_url => ({ ...await decode(source_url), source_url }))),
        get blockedUntil() { return blockedUntil; } };
}
