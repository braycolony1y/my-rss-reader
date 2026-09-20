import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function isVerificationPage(data) {
    if (!data || typeof data !== 'object' || !('contentHtml' in data)) return false;
    const frames = data.diagnostics?.frames || [];
    if (String(data.contentHtml).replace(/<[^>]*>/g, '').length < 1500
        && frames.some(frame => /captcha-delivery\.com|challenges\.cloudflare\.com/i.test(frame.src || ''))) return true;
    return /verifying the device|requested content will be available after verification|verify (?:that )?you are (?:a )?human|are you a robot|press\s*(?:&amp;|&|and)\s*hold.*human|enable javascript and cookies to continue|captcha-delivery\.com\/interstitial|please (?:complete|solve) the captcha/i
        .test(`${data.title || ''}\n${data.contentHtml || ''}`);
}

export function isActiveArticleSession(session, url, now = Date.now()) {
    return Boolean(session && session.url === url && now - session.lastSeen < 3000);
}


// ---------------------------------------------------------------------------
// OpenCLI browser fetch
//
// Normal path for every source configured with `opencli-fetch`:
//   persistent OpenCLI browser profile cookies -> direct Node HTTP fetch
//
// No publisher tab is opened on a successful normal fetch.
//
// If direct HTTP is stale/blocked:
//   real Chrome open once -> refresh cookies/request template -> retry direct
//   -> if still blocked, fetch() in the same one-tab-per-origin queue.
// The tab closes only when that origin queue becomes empty.
//
// Fetch transport is generic. Source-specific parsing belongs in source handlers.
// ---------------------------------------------------------------------------

const openCliBrowserFetchStates = new Map();
const openCliBrowserFetchQueues = new Map();

// OPENCLI_FETCH_SHARED_ORIGIN_CONTEXT_V3
// Priority lanes schedule work above this transport. opencli-fetch owns
// one shared background browser page/context per origin regardless of P lane.
const OPENCLI_BROWSER_FETCH_IDLE_CLOSE_MS = Math.max(
    0,
    Number(process.env.OPENCLI_BROWSER_FETCH_IDLE_CLOSE_MS || 60000)
);

const openCliBrowserFetchSleep = ms =>
    new Promise(resolve => setTimeout(resolve, ms));

const OPENCLI_BROWSER_FETCH_DEFAULT_HEADERS = Object.freeze({
    'User-Agent':
        process.env.OPENCLI_BROWSER_USER_AGENT
        || 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
    'sec-ch-ua':
        process.env.OPENCLI_BROWSER_SEC_CH_UA
        || '"Not?A_Brand";v="24", "Chromium";v="152"',
    'sec-ch-ua-mobile':
        process.env.OPENCLI_BROWSER_SEC_CH_UA_MOBILE
        || '?0',
    'sec-ch-ua-platform':
        process.env.OPENCLI_BROWSER_SEC_CH_UA_PLATFORM
        || '"Linux"'
});

function isOpenCliBrowserFetchChallenge(status, html = '') {
    return status === 401
        || status === 403
        || status === 429
        || /Just a moment|cf-chl-|Enable JavaScript and cookies|Checking your browser|Verifying you are human|captcha-delivery\.com|Please enable JS and disable any ad blocker/i
            .test(String(html));
}

function sanitizeOpenCliBrowserRequestHeaders(headers = {}) {
    const result = {};
    const blocked = new Set([
        'cookie',
        'host',
        'content-length',
        'connection',
        'accept-encoding',
        'transfer-encoding',
        'proxy-connection'
    ]);

    for (const [rawName, rawValue] of Object.entries(headers || {})) {
        const name = String(rawName || '').trim();
        if (!name || name.startsWith(':')) continue;

        const lower = name.toLowerCase();
        if (blocked.has(lower)) continue;

        const value = String(rawValue ?? '').trim();
        if (!value) continue;

        result[name] = value;
    }

    return result;
}

function sameOpenCliBrowserFetchUrl(left, right) {
    try {
        const normalize = value => {
            const parsed = new URL(value);
            parsed.hash = '';
            parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
            return parsed.href;
        };
        return normalize(left) === normalize(right);
    } catch {
        return String(left || '') === String(right || '');
    }
}

function createOpenCliBrowserPage(Page, session, profile) {
    return new Page(
        session,        // session
        3600,           // queue owns lifecycle; close explicitly when origin queue becomes empty
        undefined,      // contextId
        'background',   // windowMode
        'browser',      // surface
        'persistent',   // siteSession
        profile         // preferredContextId / OpenCLI profile alias
    );
}

async function getOpenCliBrowserFetchState(url) {
    const parsed = new URL(url);
    const origin = parsed.origin;

    let state = openCliBrowserFetchStates.get(origin);
    if (state) return state;

    const [
        { Page },
        { setDaemonCommandTimeoutSeconds }
    ] = await Promise.all([
        import('../node_modules/@jackwener/opencli/dist/src/browser/page.js'),
        import('../node_modules/@jackwener/opencli/dist/src/browser/daemon-client.js')
    ]);

    setDaemonCommandTimeoutSeconds(25);

    const profile =
        process.env.OPENCLI_BROWSER_PROFILE
        || process.env.OPENCLI_PROFILE
        || undefined;

    const session =
        'rss-browser-fetch-' +
        parsed.hostname
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');

    const createPage = () => createOpenCliBrowserPage(
        Page,
        session,
        profile
    );

    state = {
        origin,
        hostname: parsed.hostname,
        page: createPage(),
        createPage,
        requestHeaders: {},
        initialized: false,
        browserReady: false,
        browserLeaseOpen: false,
        refreshedAt: 0,
        directDisabled: false,
        directDisabledAt: 0,
        directDisabledReason: '',
        refreshPromise: null
    };

    openCliBrowserFetchStates.set(origin, state);
    return state;
}

async function waitForOpenCliBrowserUsablePage(page, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    let last = null;

    while (Date.now() < deadline) {
        try {
            last = await page.evaluate(`(() => {
                const html = document.documentElement?.outerHTML || '';

                return {
                    url: location.href,
                    title: document.title || '',
                    size: html.length,
                    readyState: document.readyState,
                    challenge:
                        /Just a moment|cf-chl-|Enable JavaScript and cookies|Checking your browser|Verifying you are human|captcha-delivery\\.com|Please enable JS and disable any ad blocker/i
                            .test(html)
                };
            })()`);

            if (
                last
                && !last.challenge
                && last.readyState !== 'loading'
                && Number(last.size || 0) > 1000
            ) {
                await openCliBrowserFetchSleep(750);
                return last;
            }
        } catch {
        }

        await openCliBrowserFetchSleep(500);
    }

    throw new Error(
        'OpenCLI browser navigation did not become usable'
        + (last?.title ? `: ${last.title}` : '')
    );
}

async function refreshOpenCliBrowserFetchSession(state, url) {
    // OPENCLI_FETCH_CURL_REFRESH_SHARED_BROWSER_V3
    // A real navigation is only for refreshing stale publisher state.
    // The same tab is retained for browser-fetch fallback until this origin's
    // queue becomes empty.
    console.log(
        `[OPENCLI FETCH] Opening/refreshing shared background browser page for ${state.origin}`
    );

    const page = state.page;
    state.browserLeaseOpen = true;
    let captureStarted = false;

    try {
        try {
            await page.startNetworkCapture(state.hostname);
            captureStarted = true;
        } catch {
        }

        // OPENCLI_FETCH_ROOT_BOOTSTRAP_FINAL_V1
        // Bootstrap/refresh is origin-scoped. Exact article/thread URLs
        // are retrieved later with browser-side fetch(url) in this same
        // shared origin context; never navigate to the article URL here.
        const bootstrapUrl = new URL('/', state.origin).href;
        await page.goto(bootstrapUrl, {
            settleMs: 2000
        });

        await waitForOpenCliBrowserUsablePage(page);

        if (captureStarted) {
            try {
                const entries = await page.readNetworkCapture();
                const sameOriginEntries = (entries || []).filter(entry => {
                    if (String(entry?.method || '').toUpperCase() !== 'GET') return false;
                    try {
                        return new URL(entry.url).origin === state.origin;
                    } catch {
                        return false;
                    }
                });

                const successful = sameOriginEntries.filter(entry => {
                    const status = Number(entry?.responseStatus || 0);
                    return status >= 200 && status < 400;
                });

                const exact =
                    [...successful].reverse().find(entry =>
                        sameOpenCliBrowserFetchUrl(entry.url, bootstrapUrl)
                    )
                    || [...sameOriginEntries].reverse().find(entry =>
                        sameOpenCliBrowserFetchUrl(entry.url, bootstrapUrl)
                    );

                const chosen =
                    exact
                    || successful[successful.length - 1]
                    || sameOriginEntries[sameOriginEntries.length - 1];

                if (chosen?.requestHeaders) {
                    state.requestHeaders =
                        sanitizeOpenCliBrowserRequestHeaders(chosen.requestHeaders);
                }
            } catch {
            }
        }

        if (!Object.keys(state.requestHeaders || {}).some(
            name => name.toLowerCase() === 'user-agent'
        )) {
            try {
                const userAgent = await page.evaluate('navigator.userAgent');
                if (userAgent) {
                    state.requestHeaders ||= {};
                    state.requestHeaders['User-Agent'] = String(userAgent);
                }
            } catch {
            }
        }

        state.initialized = true;
        state.browserReady = true;
        state.refreshedAt = Date.now();
    } catch (error) {
        state.browserReady = false;
        throw error;
    }
}

async function openCliProfileFetchOnce(state, url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    try {
        const cookies = await state.page.getCookies({ url });
        const cookieHeader = (cookies || [])
            .filter(cookie => cookie?.name)
            .map(cookie => `${cookie.name}=${cookie.value ?? ''}`)
            .join('; ');

        const headers = {
            ...OPENCLI_BROWSER_FETCH_DEFAULT_HEADERS,
            ...sanitizeOpenCliBrowserRequestHeaders(state.requestHeaders)
        };

        if (cookieHeader) headers.Cookie = cookieHeader;

        const response = await fetch(url, {
            method: 'GET',
            redirect: 'follow',
            headers,
            signal: controller.signal
        });

        const html = await response.text();

        if (html.length > 12 * 1024 * 1024) {
            throw new Error('OpenCLI browser fetch response exceeded 12 MB');
        }

        return {
            status: response.status,
            finalUrl: response.url,
            html
        };
    } finally {
        clearTimeout(timeout);
    }
}


function isOpenCliStalePageIdentityError(error) {
    const message = error instanceof Error
        ? error.message
        : String(error || '');

    return message.includes('stale page identity')
        || /^Page not found:\s*\S+(?:\s+—.*)?$/i.test(message);
}

async function evaluateOpenCliSharedBrowserPage(state, input, ...args) {
    // OPENCLI_FETCH_STALE_LEASE_REBIND_V5
    // OpenCLI's Page caches a targetId after goto(). The extension can evict
    // that cached identity while the session lease + physical tab are still
    // alive. evaluate() does not auto-recover this case, so clear only the
    // cached targetId and retry through the existing session lease. No goto(),
    // no new tab, and no publisher navigation is performed here.
    try {
        return await state.page.evaluate(input, ...args);
    } catch (error) {
        if (
            !state.browserLeaseOpen
            || !isOpenCliStalePageIdentityError(error)
        ) {
            throw error;
        }

        const staleTarget =
            state.page.getActivePage?.()
            || 'unknown';

        console.warn(
            `[OPENCLI FETCH] Shared browser page identity stale for ${state.origin}: `
            + `target=${staleTarget}; rebinding through existing session lease `
            + `without navigation`
        );

        state.page.setActivePage?.(undefined);

        try {
            const result = await state.page.evaluate(input, ...args);

            console.log(
                `[OPENCLI FETCH] Rebound existing shared browser tab for ${state.origin} `
                + `without navigation or opening another tab`
            );

            return result;
        } catch (retryError) {
            console.warn(
                `[OPENCLI FETCH] Existing shared browser lease rebind failed for ${state.origin}: `
                + `${retryError instanceof Error ? retryError.message : String(retryError)}`
            );
            throw retryError;
        }
    }
}

async function openCliBrowserFetchOnce(state, url) {
    if (!state.browserReady) {
        throw new Error('OpenCLI shared browser tab is not ready');
    }

    const result = await evaluateOpenCliSharedBrowserPage(state,
        async targetUrl => {
            const controller = new AbortController();
            const timeout = setTimeout(
                () => controller.abort(),
                20000
            );

            try {
                const response = await fetch(targetUrl, {
                    method: 'GET',
                    credentials: 'include',
                    cache: 'no-store',
                    redirect: 'follow',
                    signal: controller.signal
                });

                const html = await response.text();

                return {
                    status: response.status,
                    finalUrl: response.url,
                    html
                };
            } finally {
                clearTimeout(timeout);
            }
        },
        url
    );

    if (!result || typeof result.html !== 'string') {
        throw new Error('OpenCLI browser fetch returned no HTML');
    }

    if (result.html.length > 12 * 1024 * 1024) {
        throw new Error('OpenCLI browser fetch response exceeded 12 MB');
    }

    return result;
}

function openCliBrowserFetchResultIsUsable(result) {
    if (!result || typeof result.html !== 'string') return false;
    if (isOpenCliBrowserFetchChallenge(result.status, result.html)) return false;
    if (result.status === 404 || result.status === 410) return true;
    return result.status >= 200 && result.status < 400;
}

function finishOpenCliBrowserFetchResult(result) {
    if (!result || typeof result.html !== 'string') {
        throw new Error('OpenCLI browser fetch returned no HTML');
    }

    if (isOpenCliBrowserFetchChallenge(result.status, result.html)) {
        throw new Error(
            `OpenCLI browser fetch remained behind verification (HTTP ${result.status})`
        );
    }

    if (result.status === 404 || result.status === 410) {
        return `<!-- RSS_SOURCE_HTTP_STATUS:${result.status} -->${result.html}`;
    }

    if (result.status < 200 || result.status >= 400) {
        throw new Error(
            `OpenCLI browser fetch returned HTTP ${result.status}`
        );
    }

    return result.html;
}

async function closeOpenCliBrowserFetchQueueTab(state) {
    if (!state?.browserLeaseOpen) return;

    console.log(
        `[OPENCLI FETCH] Origin request set idle; closing shared browser page for ${state.origin}`
    );

    const page = state.page;
    state.browserReady = false;
    state.browserLeaseOpen = false;

    await page.closeWindow?.().catch(() => {});

    state.page = state.createPage();
}

// OPENCLI_FETCH_DIRECT_DISABLE_PARALLEL_V4
//
// Per-origin transport policy:
//   1. Try direct Node HTTP first unless this origin was proven incompatible.
//   2. On direct failure, navigate/refresh ONE shared OpenCLI tab.
//   3. After that real-browser refresh, start a fresh direct retry and
//      browser-context fetch in parallel in the SAME shared tab.
//   4. If the fresh direct retry still fails, disable direct HTTP for this
//      origin for the rest of this process and immediately use the already
//      running browser result.
//   5. While direct is disabled, every later job skips curl/direct entirely
//      and reuses the shared browser tab. The existing per-origin queue closes
//      that tab only when the origin queue becomes empty.
//   6. A service/process restart intentionally clears directDisabled so an
//      origin can be tested again in the future.

function describeOpenCliFetchAttempt(result, error = null) {
    const html = typeof result?.html === 'string' ? result.html : '';
    const status = Number(result?.status || 0);
    const challenge = Boolean(
        result && isOpenCliBrowserFetchChallenge(status, html)
    );

    return {
        error: error?.message || '',
        status,
        length: html.length,
        challenge,
        usable: Boolean(
            !error && openCliBrowserFetchResultIsUsable(result)
        )
    };
}

function formatOpenCliFetchAttempt(details) {
    if (details?.error) return `error=${JSON.stringify(details.error)}`;
    return [
        `status=${details?.status || 0}`,
        `length=${details?.length || 0}`,
        `challenge=${Boolean(details?.challenge)}`,
        `usable=${Boolean(details?.usable)}`
    ].join(' ');
}

function disableOpenCliDirectFetch(state, {
    initialAttempt,
    freshAttempt
} = {}) {
    if (state.directDisabled) return;

    const disabledAt = new Date().toISOString();
    const reason =
        'fresh direct retry remained blocked after a successful real-browser refresh';

    state.directDisabled = true;
    state.directDisabledAt = disabledAt;
    state.directDisabledReason = reason;
    state.directDisabledDetails = {
        initialAttempt,
        freshAttempt
    };

    console.warn(
        `[OPENCLI FETCH] DIRECT DISABLED for ${state.origin}: `
        + `${reason}; futureRequests=browser-fetch-only until service restart; `
        + `disabledAt=${disabledAt}; `
        + `initial={${formatOpenCliFetchAttempt(initialAttempt)}}; `
        + `fresh={${formatOpenCliFetchAttempt(freshAttempt)}}`
    );
}

function logOpenCliDirectDisabledSkip(state) {
    console.warn(
        `[OPENCLI FETCH] Skipping direct fetch for ${state.origin}: `
        + `directDisabled=true; `
        + `disabledAt=${state.directDisabledAt || 'unknown'}; `
        + `reason=${JSON.stringify(state.directDisabledReason || 'unknown')}; `
        + `futureRequests=browser-fetch-only until service restart`
    );
}

async function attemptOpenCliDirectFetch(state, url) {
    let result = null;
    let error = null;

    try {
        result = await openCliProfileFetchOnce(state, url);
    } catch (caught) {
        error = caught;
    }

    return {
        result,
        error,
        details: describeOpenCliFetchAttempt(result, error)
    };
}

async function attemptOpenCliBrowserFetch(state, url) {
    let result = null;
    let error = null;

    try {
        result = await openCliBrowserFetchOnce(state, url);
    } catch (caught) {
        error = caught;
    }

    return {
        result,
        error,
        details: describeOpenCliFetchAttempt(result, error)
    };
}

async function ensureOpenCliSharedBrowserReady(state, url, {
    forceRefresh = false
} = {}) {
    if (state.browserReady && !forceRefresh) {
        console.log(
            `[OPENCLI FETCH] Reusing shared browser page for ${state.origin}`
        );
        return;
    }

    // Only real navigation/session refresh is serialized. Normal same-origin
    // article/thread retrieval uses fetch(url) inside this one shared page.
    if (state.refreshPromise) {
        console.log(
            `[OPENCLI FETCH] Waiting for in-progress shared browser refresh for ${state.origin}`
        );
        await state.refreshPromise;
        return;
    }

    const refreshTask = (async () => {
        if (state.browserReady && !forceRefresh) return;
        await refreshOpenCliBrowserFetchSession(state, url);
    })();

    state.refreshPromise = refreshTask;

    try {
        await refreshTask;
    } finally {
        if (state.refreshPromise === refreshTask) {
            state.refreshPromise = null;
        }
    }
}

async function runOpenCliBrowserOnly(state, url, {
    existingAttempt = null
} = {}) {
    await ensureOpenCliSharedBrowserReady(state, url);

    let browserAttempt =
        existingAttempt
        || await attemptOpenCliBrowserFetch(state, url);

    if (browserAttempt.details.usable) {
        console.log(
            `[OPENCLI FETCH] Shared browser fetch succeeded for ${state.origin}: `
            + formatOpenCliFetchAttempt(browserAttempt.details)
        );
        return finishOpenCliBrowserFetchResult(browserAttempt.result);
    }

    console.warn(
        `[OPENCLI FETCH] Shared browser fetch stale/blocked for ${state.origin}: `
        + `${formatOpenCliFetchAttempt(browserAttempt.details)}; `
        + `refreshing the SAME shared tab once`
    );

    state.browserReady = false;
    await ensureOpenCliSharedBrowserReady(state, url, {
        forceRefresh: true
    });

    browserAttempt = await attemptOpenCliBrowserFetch(state, url);

    if (!browserAttempt.details.usable) {
        console.warn(
            `[OPENCLI FETCH] Shared browser retry failed for ${state.origin}: `
            + formatOpenCliFetchAttempt(browserAttempt.details)
        );
    }

    return finishOpenCliBrowserFetchResult(browserAttempt.result);
}

async function runOpenCliBrowserFetchNow(url) {
    const parsed = new URL(url);

    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error(
            'OpenCLI browser fetch only supports HTTP(S) URLs'
        );
    }

    const state = await getOpenCliBrowserFetchState(url);

    if (state.directDisabled) {
        logOpenCliDirectDisabledSkip(state);
        return runOpenCliBrowserOnly(state, url);
    }

    const initialDirect = await attemptOpenCliDirectFetch(state, url);

    if (initialDirect.details.usable) {
        return finishOpenCliBrowserFetchResult(initialDirect.result);
    }

    console.warn(
        `[OPENCLI FETCH] Direct profile fetch failed for ${state.origin}: `
        + formatOpenCliFetchAttempt(initialDirect.details)
    );

    await ensureOpenCliSharedBrowserReady(state, url, {
        forceRefresh: true
    });

    console.log(
        `[OPENCLI FETCH] Starting fresh direct retry + shared browser fetch `
        + `in parallel for ${state.origin}`
    );

    const [freshDirect, parallelBrowser] = await Promise.all([
        attemptOpenCliDirectFetch(state, url),
        attemptOpenCliBrowserFetch(state, url)
    ]);

    if (freshDirect.details.usable) {
        console.log(
            `[OPENCLI FETCH] Fresh direct retry succeeded for ${state.origin}: `
            + formatOpenCliFetchAttempt(freshDirect.details)
        );
        return finishOpenCliBrowserFetchResult(freshDirect.result);
    }

    disableOpenCliDirectFetch(state, {
        initialAttempt: initialDirect.details,
        freshAttempt: freshDirect.details
    });

    if (parallelBrowser.details.usable) {
        console.log(
            `[OPENCLI FETCH] Parallel shared browser fetch succeeded for ${state.origin}: `
            + formatOpenCliFetchAttempt(parallelBrowser.details)
        );
        return finishOpenCliBrowserFetchResult(parallelBrowser.result);
    }

    console.warn(
        `[OPENCLI FETCH] Parallel shared browser fetch also failed for ${state.origin}: `
        + `${formatOpenCliFetchAttempt(parallelBrowser.details)}; `
        + `direct remains disabled and the SAME shared tab will be refreshed once`
    );

    return runOpenCliBrowserOnly(state, url, {
        existingAttempt: parallelBrowser
    });
}

export function runOpenCliBrowserFetch(url) {
    let origin;

    try {
        origin = new URL(url).origin;
    } catch {
        return Promise.reject(
            new Error('Invalid URL for OpenCLI browser fetch')
        );
    }

    let tracker = openCliBrowserFetchQueues.get(origin);

    if (!tracker || typeof tracker !== 'object' || !('pending' in tracker)) {
        tracker = {
            pending: 0,
            closeTimer: null,
            closePromise: null
        };
        openCliBrowserFetchQueues.set(origin, tracker);
    }

    if (tracker.closeTimer) {
        clearTimeout(tracker.closeTimer);
        tracker.closeTimer = null;
    }

    tracker.pending += 1;

    // P lanes are scheduled above this layer. Do not create a per-lane page
    // and do not serialize browser-side fetch(url) calls here.
    const task = (async () => {
        // If an actual close already began, finish it before using the
        // recreated shared page. An idle-close timer itself never blocks work.
        if (tracker.closePromise) {
            await tracker.closePromise;
        }

        return runOpenCliBrowserFetchNow(url);
    })();

    return task.finally(() => {
        tracker.pending = Math.max(0, tracker.pending - 1);

        // Keep this origin's one shared page/context while ANY request remains.
        if (tracker.pending !== 0) return;

        if (tracker.closeTimer) {
            clearTimeout(tracker.closeTimer);
        }

        // OPENCLI_FETCH_ROLLING_IDLE_REUSE_V1
        // Keep this origin's shared browser context warm for a rolling idle
        // window. Any new opencli-fetch request cancels this timer above and
        // reuses the same context. This covers delayed article/thread prefetch,
        // cache ticks and follow-up page requests without creating another tab.
        // The context closes only after the origin has genuinely been idle.
        tracker.closeTimer = setTimeout(() => {
            tracker.closeTimer = null;
            if (tracker.pending !== 0) return;

            const closeTask = (async () => {
                const state = openCliBrowserFetchStates.get(origin);
                await closeOpenCliBrowserFetchQueueTab(state);
            })();

            tracker.closePromise = closeTask;

            closeTask.finally(() => {
                if (tracker.closePromise === closeTask) {
                    tracker.closePromise = null;
                }

                if (
                    tracker.pending === 0
                    && !tracker.closeTimer
                    && openCliBrowserFetchQueues.get(origin) === tracker
                ) {
                    openCliBrowserFetchQueues.delete(origin);
                }
            }).catch(() => {});
        }, OPENCLI_BROWSER_FETCH_IDLE_CLOSE_MS);
    });
}

export async function readWithHumanVerification(read, page, kwargs, canWait) {
    const guardedPage = new Proxy(page, {
        get(target, key) {
            if (key !== 'evaluate') {
                const value = target[key];
                return typeof value === 'function' ? value.bind(target) : value;
            }

            return async (...args) => {
                let data = await target.evaluate(...args);

                while (isVerificationPage(data)) {
                    if (!await canWait()) {
                        throw new Error('Publisher verification blocked this fetch.');
                    }

                    // Never activate/focus/switch Chromium. `opencli` stays in
                    // the background exactly like `opencli-fetch`.
                    await target.wait(1);
                    data = await target.evaluate(...args);
                }

                return data;
            };
        }
    });

    try {
        return await read(guardedPage, kwargs, false);
    } finally {
        await page.closeWindow?.().catch(() => {});
    }
}

export function runOpenCliReader(kwargs, canWait = () => false) {
    return new Promise((resolve, reject) => {
        const child = fork(fileURLToPath(import.meta.url), ['--worker', JSON.stringify(kwargs)], {
            silent: true, execArgv: []
        });
        let stdout = '', stderr = '';
        let timer;
        const resetTimeout = () => {
            clearTimeout(timer);
            timer = setTimeout(() => { child.kill(); }, 60_000);
        };
        resetTimeout();
        child.stdout.on('data', data => {
            stdout += data;
            if (stdout.length > 12 * 1024 * 1024) child.kill();
        });
        child.stderr.on('data', data => { stderr = (stderr + data).slice(-1024 * 1024); });
        child.on('message', message => {
            if (message?.type !== 'verification') return;
            const allowed = Boolean(canWait());
            resetTimeout();
            if (child.connected) child.send({ type: 'verification-decision', allowed });
        });
        child.on('error', error => { clearTimeout(timer); reject(error); });
        child.on('close', code => {
            clearTimeout(timer);
            if (code !== 0) reject(new Error(stderr.trim() || 'OpenCLI reader failed or timed out.'));
            else resolve({ stdout, stderr });
        });
    });
}

if (process.argv[2] === '--worker') {
    let activePage;
    process.on('SIGTERM', async () => {
        await Promise.race([
            activePage?.closeWindow?.().catch(() => {}),
            new Promise(resolve => setTimeout(resolve, 2000))
        ]);
        process.exit(1);
    });
    const canWait = () => new Promise(resolve => {
        const timeout = setTimeout(() => { process.off('message', receive); resolve(false); }, 2000);
        const receive = message => {
            if (message?.type !== 'verification-decision') return;
            clearTimeout(timeout);
            process.off('message', receive);
            resolve(message.allowed === true);
        };
        process.on('message', receive);
        if (process.connected) process.send({ type: 'verification' });
    });
    try {
        const { executeCommand } = await import('../node_modules/@jackwener/opencli/dist/src/execution.js');
        const { setDaemonCommandTimeoutSeconds } = await import('../node_modules/@jackwener/opencli/dist/src/browser/daemon-client.js');
        const { __test__: { command } } = await import('../node_modules/@jackwener/opencli/clis/web/read.js');
        await executeCommand({
            ...command,
            args: [...command.args, { name: 'timeout', type: 'int', default: 86400 }],
            func: (page, kwargs) => {
                activePage = page;
                // Human waiting may be long; individual browser operations must not be.
                setDaemonCommandTimeoutSeconds(20);
                return readWithHumanVerification(command.func, page, kwargs, canWait);
            }
        }, JSON.parse(process.argv[3]), false, { keepTab: 'true', siteSession: 'ephemeral', windowMode: 'background' });
    } catch (error) {
        process.stderr.write(error.message + '\n');
        process.exitCode = 1;
    } finally {
        if (process.connected) process.disconnect();
        // OpenCLI's daemon transport can retain sockets after the adapter ends.
        // This isolated worker owns no further work once the tab is released.
        process.exit(process.exitCode || 0);
    }
}
