import { load } from 'cheerio';
import { discardResponseBody } from '../fetch-response.js';
import { runOpenCliBrowserFetch, runOpenCliReader } from '../opencli-reader.js';
import { runArticleFetchTask, withArticleFetchLane } from '../articles/fetch-lanes.js';

function normalizeFeedUrl(url) {
    if (url === 'https://kenh14.vn/home.rss') return 'https://kenh14.vn/rss/home.rss';
    if (url === 'https://kenh14.vn/tin-moi-nhat.rss') return 'https://kenh14.vn/rss/tin-moi-nhat.rss';
    return url;
}

function acceptsFeedBody(body, url) {
    const $ = load(body, { xmlMode: true });
    const element = $.root().children().first();
    const root = element[0]?.name || '';
    // Empty RSS/Atom feeds are valid, too. Do not require an item count.
    if (/^(?:rss|feed|rdf:RDF)$/i.test(root)) {
        const complete = new RegExp(`</${root}\\s*>\\s*$`, 'i').test(body.replace(/<!--[\s\S]*?-->/g, ''));
        const structure = root.toLowerCase() === 'feed'
            ? element.children('title, entry').length > 0
            : element.children('channel').length > 0;
        return complete && structure;
    }

    // BaoMoi intentionally feeds its HTML listing into a dedicated parser.
    const hostname = new URL(url).hostname;
    return /(?:^|\.)baomoi\.com$/i.test(hostname)
        && root.toLowerCase() === 'html'
        && !/cf-chl-|just a moment|enable javascript and cookies|attention required|checking your browser/i.test(body);
}

function inBackground(url, task) {
    return withArticleFetchLane('p3', () => runArticleFetchTask(url, task), { source: 'rss-feed' });
}

async function readFeedWithOpenCli(url) {
    const { stdout } = await runOpenCliReader({
        url, stdout: true, 'download-images': false, wait: 5
    });
    return stdout;
}

export function createFeedFetcher({
    CF_PROXY_BASE,
    VIETSERVER_PROXY_BASE,
    BROWSER_HEADERS,
    fetchFn = (...args) => fetch(...args),
    openCliFetch = url => inBackground(url, () => runOpenCliBrowserFetch(url)),
    openCliRead = url => inBackground(url, () => readFeedWithOpenCli(url)),
    timeoutMs = 15000,
    log = message => console.log(message),
} = {}) {
    async function fetchHttp(url, headers) {
        return fetchFn(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    }

    return async function fetchFeedResponse(url) {
        const target = normalizeFeedUrl(url);
        const methods = [
            ['direct', () => fetchHttp(target, BROWSER_HEADERS)],
            ...(CF_PROXY_BASE ? [['cloudflare', () => fetchHttp(CF_PROXY_BASE + encodeURIComponent(target), BROWSER_HEADERS)]] : []),
            ...(VIETSERVER_PROXY_BASE ? [['vietserver', () => fetchHttp(VIETSERVER_PROXY_BASE + encodeURIComponent(target), {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            })]] : []),
            ['opencli-fetch', () => openCliFetch(target)],
            ['opencli', () => openCliRead(target)],
        ];
        const failures = [];

        for (const [method, run] of methods) {
            let response;
            try {
                const result = await run();
                const isHttp = typeof result !== 'string';
                if (isHttp) {
                    response = result;
                    // A removed feed should retain its original HTTP error.
                    if (method === 'direct' && [404, 410].includes(response.status)) return response;
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                }
                const body = isHttp ? await response.text() : result;
                if (!acceptsFeedBody(body, target)) throw new Error('Received unusable feed content instead of RSS/Atom XML');

                if (failures.length) log(`[RSS FETCH] ${method} succeeded for ${target} after ${failures.join('; ')}`);
                return new Response(body, {
                    status: isHttp ? response.status : 200,
                    headers: { 'Content-Type': isHttp ? response.headers.get('content-type') || 'application/xml' : 'application/xml' }
                });
            } catch (error) {
                const failure = `${method}: ${String(error.message || error).slice(0, 200)}`;
                failures.push(failure);
                log(`[RSS FETCH] ${failure} for ${target}; trying next method`);
            } finally {
                // Failed HTTP attempts must not hold open unread bodies.
                if (response && !(method === 'direct' && [404, 410].includes(response.status))) {
                    await discardResponseBody(response);
                }
            }
        }

        throw new Error(`All RSS fetch methods failed (${failures.join('; ')})`);
    };
}
