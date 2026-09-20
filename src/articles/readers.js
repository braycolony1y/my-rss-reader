import { fetchRedditViaOpenCli } from '../sources/reddit-fetcher.js';
import { runArticleFetchTask } from './fetch-lanes.js';
import sourceRegistry from '../sources/index.js';
import { normalizeArticleSourceUrl, deletedSourceKind, deletedSourceTitle } from '../article-source-state.js';
import { safeHttpUrl } from '../utils/article-utils.js';
import { runOpenCliReader, runOpenCliBrowserFetch, isActiveArticleSession } from '../opencli-reader.js';
import { parseOpenCliMarkdown, parseJinaReaderText } from './reader-markdown.js';
import { assertArticleResultAcceptedBySource } from './source-results.js';
import { discardResponseBody } from '../fetch-response.js';
import { isUnsafeVozThreadPayload } from '../voz-thread-state.js';

export function createArticleReaders({
    VIETSERVER_PROXY_BASE,
    articleReaderSessions,
    updateArticleFetchProgress,
    JINA_READER_BASE,
    BROWSER_HEADERS,
    CF_PROXY_BASE,
} = {}) {
    async function fetchViaVietserver(url) {
        if (!VIETSERVER_PROXY_BASE) throw new Error("Vietserver proxy not configured in .env");
        const fetchUrl = VIETSERVER_PROXY_BASE + encodeURIComponent(url);
        const res = await fetch(fetchUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        if (!res.ok && res.status !== 404 && res.status !== 403 && res.status !== 410) throw new Error(`Vietserver proxy returned HTTP ${res.status}`);
        const body = await res.text();
        return (res.status === 404 || res.status === 410)
            ? `<!-- RSS_SOURCE_HTTP_STATUS:${res.status} -->${body}`
            : body;
    }

    async function fetchViaOpenCli(url, requestId = '') {
        if (url.match(/reddit\.com\/r\/.*\/comments\//)) {
            return fetchRedditViaOpenCli(url);
        }
        const sourceHandler = sourceRegistry.getHandler(url);
        const readerUrl = normalizeArticleSourceUrl(sourceHandler?.getOpenCliReaderUrl?.(url) || url);
        const captureDiagnostics = Boolean(sourceHandler?.needsOpenCliDiagnostics?.());
        const waitSeconds = Math.max(3, Math.min(30, Number(sourceHandler?.getOpenCliWaitSeconds?.()) || 3));
        const fallbackReaderUrls = (sourceHandler?.getOpenCliFallbackReaderUrls?.(url) || [])
            .map(candidate => normalizeArticleSourceUrl(candidate))
            .filter(candidate => safeHttpUrl(candidate) && candidate !== readerUrl);
        const readerCandidates = [readerUrl, ...new Set(fallbackReaderUrls)];
        let stdout = '';
        let stderr = '';
        let remainedOnVerificationPage = false;

        for (let index = 0; index < readerCandidates.length; index++) {
            const candidateWaitSeconds = index === 0 ? waitSeconds : 5;
            let commandResult;
            try {
                commandResult = await runOpenCliReader({
                    url: readerCandidates[index], stdout: true, 'download-images': false,
                    wait: candidateWaitSeconds, diagnose: captureDiagnostics
                }, () => {
                    if (!isActiveArticleSession(articleReaderSessions.get(requestId), url)) return false;
                    updateArticleFetchProgress(requestId, 'verification',
                        'Please complete the CAPTCHA in the OpenCLI Chrome window. Keep this article open; reading will resume automatically after verification.',
                        { method: 'opencli', requiresHumanVerification: true });
                    return true;
                });
            } catch (error) {
                if (!/Publisher verification blocked this fetch/i.test(error.message)) throw error;
                remainedOnVerificationPage = true;
                continue;
            }
            stdout = commandResult.stdout;
            stderr = commandResult.stderr;
            remainedOnVerificationPage = /(?:verifying the device|requested content will be available after verification|captcha-delivery\.com\/interstitial|press\s*(?:&|and)\s*hold\s+to confirm you are a human)/i.test(`${stdout}\n${stderr}`);
            if (!remainedOnVerificationPage && stdout.trim()) break;
        }
        if (remainedOnVerificationPage || !stdout.trim()) {
            throw new Error('OpenCLI remained on the publisher device-verification page after waiting');
        }
        const parsed = parseOpenCliMarkdown(stdout, url, { diagnostics: stderr });
        if (parsed.isDeletedSource) return parsed;
        assertArticleResultAcceptedBySource(url, parsed);
        const textLength = parsed.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length;
        if (textLength < 200 && !/<(?:img|video|audio)\b/i.test(parsed.content)) {
            throw new Error('OpenCLI returned too little article content');
        }
        return parsed;
    }

    async function fetchViaOpenCliBrowserFetch(url) {
        url = normalizeArticleSourceUrl(url);

        if (!safeHttpUrl(url)) {
            throw new Error('Invalid URL for OpenCLI browser fetch');
        }

        return runOpenCliBrowserFetch(url);
    }

    async function fetchViaJina(url) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        try {
            const canonicalUrl = String(url).replace(/\/unread\/?(?:[?#].*)?$/i, '');
            const response = await fetch(JINA_READER_BASE + canonicalUrl, {
                signal: controller.signal,
                headers: { Accept: 'text/plain' }
            });
            if (response.status === 404 || response.status === 410) {
                await discardResponseBody(response);
                const kind = deletedSourceKind(url);
                return {
                    title: deletedSourceTitle(url),
                    author: '',
                    date: '',
                    image: '',
                    siteName: new URL(url).hostname.replace(/^www\./, ''),
                    content: '',
                    readerType: `deleted-${kind}`,
                    source: 'jina-reader',
                    isDeletedSource: true,
                    isDeletedThread: kind === 'thread'
                };
            }
            if (!response.ok) {
                await discardResponseBody(response);
                throw new Error('Jina Reader returned HTTP ' + response.status);
            }
            const parsed = parseJinaReaderText(await response.text(), url);
            if (parsed.isDeletedSource) return parsed;
            if (isUnsafeVozThreadPayload(url, parsed)) throw new Error('Jina Reader returned a VOZ error page');
            assertArticleResultAcceptedBySource(url, parsed);
            const textLength = parsed.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length;
            const hasMedia = /<(?:img|video|audio)\b/i.test(parsed.content);
            const minimumLength = parsed.readerType === 'forum-post' ? 40 : 200;
            if (textLength < minimumLength && !hasMedia) throw new Error('Jina Reader returned too little article text');
            return parsed;
        } finally {
            clearTimeout(timeout);
        }
    }

    // Helper to fetch a URL while manually following redirects and persisting cookies.
    // Needed for sites like qdnd.vn that do a 302 back to the same URL with a Set-Cookie.
    async function fetchWithCookies(targetUrl, timeoutMs = 8000, maxRedirects = 5) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
            let currentUrl = targetUrl;
            let cookie = '';
            for (let i = 0; i < maxRedirects; i++) {
                const options = {
                    redirect: 'manual',
                    headers: { ...BROWSER_HEADERS },
                    signal: controller.signal
                };
                if (cookie) options.headers['Cookie'] = cookie;

                const res = await fetch(currentUrl, options);

                if (res.status >= 300 && res.status < 400) {
                    const setCookie = res.headers.get('set-cookie');
                    if (setCookie) {
                        // Keep all cookie key=value pairs, ignore the directives like Domain=
                        const cookieParts = setCookie.split(/,\s*(?=[^;]+?=)/);
                        const combinedCookies = cookieParts.map(c => c.split(';')[0]).join('; ');
                        cookie = combinedCookies;
                    }
                    currentUrl = res.headers.get('location') || currentUrl;
                    if (!currentUrl.startsWith('http')) currentUrl = new URL(currentUrl, res.url || targetUrl).href;
                    await discardResponseBody(res);
                } else if (res.ok || res.status === 404 || res.status === 403 || res.status === 410) {
                    const body = await res.text();
                    return (res.status === 404 || res.status === 410)
                        ? `<!-- RSS_SOURCE_HTTP_STATUS:${res.status} -->${body}`
                        : body;
                } else {
                    let errorBody = '';
                    try {
                        errorBody = await res.text();
                        errorBody = errorBody.substring(0, 200).replace(/[\n\r\t]+/g, ' ').trim();
                    } catch (e) { }
                    throw new Error(`HTTP ${res.status} ${res.statusText}${errorBody ? ` | ${errorBody}` : ''}`);
                }
            }
            throw new Error('Too many redirects');
        } finally { clearTimeout(timeout); }
    }

    const pendingDirectFetches = new Map();

    async function fetchArticleHtmlByStrategy(strategy, url) {
        url = normalizeArticleSourceUrl(url);
        if (strategy === 'opencli-fetch') {
            return await fetchViaOpenCliBrowserFetch(url);
        }
        if (strategy === 'direct') {
            if (!pendingDirectFetches.has(url)) {
                const pending = fetchWithCookies(url).finally(() => pendingDirectFetches.delete(url));
                pendingDirectFetches.set(url, pending);
            }
            return pendingDirectFetches.get(url);
        }
        if (strategy === 'vietserver') return await fetchViaVietserver(url);

        const controller = new AbortController();
        const timeoutMs = strategy === 'cloudflare' ? 8000 : 10000;
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const cbParam = (url.includes('?') ? '&' : '?') + '_cb=' + Date.now();
            const fetchUrl = strategy === 'cloudflare'
                ? CF_PROXY_BASE + encodeURIComponent(url + cbParam)
                : 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url + cbParam);
            const response = await fetch(fetchUrl, { signal: controller.signal });
            if (!response.ok && response.status !== 404 && response.status !== 403 && response.status !== 410) {
                await discardResponseBody(response);
                throw new Error('HTTP ' + response.status);
            }
            const body = await response.text();
            return (response.status === 404 || response.status === 410)
                ? `<!-- RSS_SOURCE_HTTP_STATUS:${response.status} -->${body}`
                : body;
        } finally {
            clearTimeout(timeout);
        }
    }

    // ARTICLE_FETCH_PRIORITY_LANES_V1
    // Scheduling is deliberately outside strategy selection: whichever method
    // policy selected is the exact method that runs in the current lane.
    const scheduleUrlFirst = fn => (url, ...args) =>
        runArticleFetchTask(url, () => fn(url, ...args));

    return {
        fetchWithCookies: scheduleUrlFirst(fetchWithCookies),
        fetchViaOpenCli: scheduleUrlFirst(fetchViaOpenCli),
        fetchViaOpenCliBrowserFetch: scheduleUrlFirst(fetchViaOpenCliBrowserFetch),
        fetchViaVietserver: scheduleUrlFirst(fetchViaVietserver),
        fetchViaJina: scheduleUrlFirst(fetchViaJina),
        fetchArticleHtmlByStrategy: (strategy, url, ...args) =>
            runArticleFetchTask(url, () => fetchArticleHtmlByStrategy(strategy, url, ...args))
    };
}
