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
//   - normal sources: navigate the SAME reusable per-origin browser tab to the
//     EXACT requested URL, then read that real rendered page.
//   - VOZ only: an origin page is enough; retrieve thread/page HTML with
//     browser-side fetch(url) inside that logged-in origin context.
// Same-origin fallback jobs are serialized so the tab can change URL safely.
// The Browser Bridge owns physical cleanup with a 60-second idle lease; this
// module never calls closeWindow() on an idle fetch tab, avoiding about:blank.
//
// Fetch transport is generic. Source-specific parsing belongs in source handlers.
// ---------------------------------------------------------------------------

const openCliBrowserFetchStates = new Map();
const openCliBrowserFetchQueues = new Map();

// OPENCLI_FETCH_SHARED_ORIGIN_CONTEXT_V3
// Priority lanes schedule work above this transport. opencli-fetch owns
// one reusable background browser page/context per origin regardless of P lane.
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

// VOZ can keep one logged-in origin context and use browser-side fetch(url).
// Other OpenCLI Browser Fetch fallbacks must open the exact requested page.
function openCliBrowserFetchUsesOriginContext(state) {
    const hostname = String(state?.hostname || '').toLowerCase();
    return hostname === 'voz.vn' || hostname.endsWith('.voz.vn');
}

const OPENCLI_BROWSER_FETCH_BRIDGE_IDLE_SECONDS = 60 * 60;

function createOpenCliBrowserPage(Page, session, profile) {
    return new Page(
        session,        // session
        OPENCLI_BROWSER_FETCH_BRIDGE_IDLE_SECONDS,
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
        import('./browser/opencli-page.js'),
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

async function closeOpenCliBrowserFetchTab(page, timeoutMs = 4000) {
    if (!page?.getActivePage?.()) return false;

    try {
        await Promise.race([
            page.closeTab(),
            openCliBrowserFetchSleep(timeoutMs)
        ]);
        return true;
    } catch {
        return false;
    }
}

async function resetOpenCliBrowserFetchPage(state, {
    closeTab = false,
    reason = ''
} = {}) {
    const previous = state?.page;

    state.browserReady = false;
    state.browserLeaseOpen = false;
    state.refreshPromise = null;

    if (previous) {
        if (closeTab) {
            await closeOpenCliBrowserFetchTab(previous);
        }
        try {
            previous.setActivePage?.(undefined);
        } catch {
        }
    }

    state.page = state.createPage();

    if (reason) {
        console.log(
            `[OPENCLI FETCH] Reset shared browser page for ${state.origin}: ${reason}`
        );
    }
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
    // The same tab is retained for browser-fetch fallback and later origin work.
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

async function openCliBrowserNavigateExactPageOnce(state, url) {
    // OPENCLI_FETCH_EXACT_REAL_PAGE_FALLBACK_V3
    // Reuse the existing per-origin Page/session, but every fallback request
    // navigates that tab to the exact requested URL. This is intentionally
    // different from VOZ, where same-origin context + fetch(url) is sufficient.
    console.log(
        `[OPENCLI FETCH] Navigating reusable real-page fallback to exact URL ${url}`
    );

    const page = state.page;
    state.browserLeaseOpen = true;
    state.browserReady = false;

    try {
        await page.goto(url, {
            settleMs: 2000
        });

        const usable = await waitForOpenCliBrowserUsablePage(page);

        const result = await page.evaluate(`(() => {
            const html = document.documentElement?.outerHTML || '';
            const nav = performance.getEntriesByType?.('navigation')?.[0];
            const responseStatus = Number(nav?.responseStatus || 0);

            return {
                status: responseStatus > 0 ? responseStatus : 200,
                finalUrl: location.href,
                html,
                userAgent: navigator.userAgent || ''
            };
        })()`);

        if (!result || typeof result.html !== 'string') {
            throw new Error('OpenCLI exact-page fallback returned no HTML');
        }

        if (result.html.length > 12 * 1024 * 1024) {
            throw new Error('OpenCLI browser fetch response exceeded 12 MB');
        }

        if (result.userAgent) {
            state.requestHeaders ||= {};
            state.requestHeaders['User-Agent'] = String(result.userAgent);
        }

        state.initialized = true;
        state.browserReady = true;
        state.refreshedAt = Date.now();

        return {
            status: Number(result.status || 200),
            finalUrl: result.finalUrl || usable?.url || url,
            html: result.html
        };
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
    if (!openCliBrowserFetchUsesOriginContext(state)) {
        return openCliBrowserNavigateExactPageOnce(state, url);
    }

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


// OPENCLI_FETCH_DIRECT_DISABLE_PARALLEL_V4
//
// Per-origin transport policy:
//   1. Try direct Node HTTP first unless this origin was proven incompatible.
//   2. Normal sources: on failure, navigate ONE reusable source tab to the
//      exact requested URL and read that rendered page.
//   3. VOZ: keep the existing origin-context optimization and fetch target
//      URLs inside that logged-in page.
//   4. Retry direct once after the real browser refreshed session cookies.
//   5. If fresh direct still fails, disable direct HTTP for this origin until
//      process restart and use browser fallback only.
//   6. Browser Bridge owns the 60-second physical idle cleanup; this module
//      does not explicitly release fetch tabs to about:blank.

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

    // VOZ origin-context refresh is serialized here. Other Browser Fetch
    // sources bypass this helper and navigate the reusable tab to exact URLs.
    if (state.refreshPromise) {
        console.log(
            `[OPENCLI FETCH] Waiting for in-progress shared browser refresh for ${state.origin}`
        );
        await state.refreshPromise;
        return;
    }

    const refreshTask = (async () => {
        if (state.browserReady && !forceRefresh) return;

        try {
            await refreshOpenCliBrowserFetchSession(state, url);
        } catch (firstError) {
            // OPENCLI_SHARED_PAGE_RECOVERY_V6
            //
            // Browser Bridge may have removed the physical target while this
            // long-lived Page object still remembers the old target/session.
            // Reusing that stale Page makes every later VOZ open wait for the
            // daemon timeout and then fail again. Retire the exact stale target,
            // create a fresh Page wrapper for the SAME persistent site session,
            // and retry once.
            console.warn(
                `[OPENCLI FETCH] Shared browser refresh failed for ${state.origin}; `
                + `recreating the stale Page wrapper once: `
                + `${firstError instanceof Error ? firstError.message : String(firstError)}`
            );

            await resetOpenCliBrowserFetchPage(state, {
                closeTab: true,
                reason: 'stale/dead target recovery'
            });

            try {
                await refreshOpenCliBrowserFetchSession(state, url);
            } catch (retryError) {
                // Leave the next request with a fresh wrapper instead of the
                // just-failed target so one bad Chromium target cannot poison
                // every later VOZ open.
                await resetOpenCliBrowserFetchPage(state, {
                    closeTab: true,
                    reason: 'refresh retry failed; prepare clean next attempt'
                });
                throw retryError;
            }
        }
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
    if (!openCliBrowserFetchUsesOriginContext(state)) {
        let browserAttempt =
            existingAttempt
            || await attemptOpenCliBrowserFetch(state, url);

        if (browserAttempt.details.usable) {
            console.log(
                `[OPENCLI FETCH] Exact real-page fallback succeeded for ${state.origin}: `
                + formatOpenCliFetchAttempt(browserAttempt.details)
            );
            return finishOpenCliBrowserFetchResult(browserAttempt.result);
        }

        console.warn(
            `[OPENCLI FETCH] Exact real-page fallback stale/blocked for ${state.origin}: `
            + `${formatOpenCliFetchAttempt(browserAttempt.details)}; `
            + `reloading the SAME source tab at the exact URL once`
        );

        browserAttempt = await attemptOpenCliBrowserFetch(state, url);

        if (!browserAttempt.details.usable) {
            console.warn(
                `[OPENCLI FETCH] Exact real-page retry failed for ${state.origin}: `
                + formatOpenCliFetchAttempt(browserAttempt.details)
            );
        }

        return finishOpenCliBrowserFetchResult(browserAttempt.result);
    }

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

    if (!openCliBrowserFetchUsesOriginContext(state)) {
        // Normal Browser Fetch fallback must open the REAL requested page.
        // Reuse one per-origin tab, but navigate it to this exact URL first.
        const browserAttempt = await attemptOpenCliBrowserFetch(state, url);

        // The exact-page navigation may have refreshed cookies/session state.
        const freshDirect = await attemptOpenCliDirectFetch(state, url);

        if (freshDirect.details.usable) {
            console.log(
                `[OPENCLI FETCH] Fresh direct retry succeeded after exact-page navigation for ${state.origin}: `
                + formatOpenCliFetchAttempt(freshDirect.details)
            );
            return finishOpenCliBrowserFetchResult(freshDirect.result);
        }

        disableOpenCliDirectFetch(state, {
            initialAttempt: initialDirect.details,
            freshAttempt: freshDirect.details
        });

        if (browserAttempt.details.usable) {
            console.log(
                `[OPENCLI FETCH] Exact real-page fallback succeeded for ${state.origin}: `
                + formatOpenCliFetchAttempt(browserAttempt.details)
            );
            return finishOpenCliBrowserFetchResult(browserAttempt.result);
        }

        return runOpenCliBrowserOnly(state, url, {
            existingAttempt: browserAttempt
        });
    }

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

// OPENCLI_VOZ_SHARED_TAB_LEASE_V1
//
// All origins reuse one persistent shared browser page/context.
//
// A UI lease can additionally PIN an origin's existing shared browser page:
//   lease active   -> page is logically pinned to the viewer
//   lease released -> pin ends, but the persistent physical page stays warm
//
// The lease does NOT create a separate browser page. It owns the exact same
// one-page-per-origin context used by runOpenCliBrowserFetch().
//
// Running requests are never interrupted by lease release.

function getOpenCliBrowserFetchTracker(origin) {
    let tracker =
        openCliBrowserFetchQueues.get(origin);

    if (
        !tracker ||
        typeof tracker !== 'object' ||
        !('pending' in tracker)
    ) {
        tracker = {
            pending: 0,
            tail: Promise.resolve(),
            closeTimer: null,
            closePromise: null,
            // viewerId -> last heartbeat time. A Map is deliberate: every
            // browser tab gets its own viewer id, and stale tabs expire even
            // if pagehide/beforeunload never reaches the server.
            pinnedViewers: new Map(),
            viewerExpiryTimer: null
        };

        openCliBrowserFetchQueues.set(
            origin,
            tracker
        );
    }

    if (!(tracker.pinnedViewers instanceof Map)) {
        const previous = tracker.pinnedViewers;
        tracker.pinnedViewers = new Map();
        if (previous instanceof Set) {
            const now = Date.now();
            for (const viewerId of previous) {
                tracker.pinnedViewers.set(viewerId, now);
            }
        }
    }

    if (!('viewerExpiryTimer' in tracker)) {
        tracker.viewerExpiryTimer = null;
    }

    if (!tracker.tail || typeof tracker.tail.then !== 'function') {
        tracker.tail = Promise.resolve();
    }

    return tracker;
}


function cancelOpenCliBrowserIdleClose(tracker) {
    if (!tracker?.closeTimer) {
        return;
    }

    clearTimeout(
        tracker.closeTimer
    );

    tracker.closeTimer =
        null;
}


const OPENCLI_VOZ_VIEWER_HEARTBEAT_TTL_MS = 75_000;

function pruneOpenCliBrowserViewerPins(tracker, now = Date.now()) {
    if (!(tracker?.pinnedViewers instanceof Map)) {
        return 0;
    }

    for (const [viewerId, lastSeenAt] of tracker.pinnedViewers) {
        if (now - Number(lastSeenAt || 0) > OPENCLI_VOZ_VIEWER_HEARTBEAT_TTL_MS) {
            tracker.pinnedViewers.delete(viewerId);
        }
    }

    return tracker.pinnedViewers.size;
}

function openCliBrowserOriginPinned(tracker) {
    return pruneOpenCliBrowserViewerPins(tracker) > 0;
}

function cancelOpenCliBrowserViewerExpiry(tracker) {
    if (!tracker?.viewerExpiryTimer) return;
    clearTimeout(tracker.viewerExpiryTimer);
    tracker.viewerExpiryTimer = null;
}

function scheduleOpenCliBrowserViewerExpiry(origin, tracker) {
    if (!tracker) return;

    cancelOpenCliBrowserViewerExpiry(tracker);
    pruneOpenCliBrowserViewerPins(tracker);

    if (!(tracker.pinnedViewers instanceof Map) || !tracker.pinnedViewers.size) {
        if (tracker.pending === 0) {
            scheduleOpenCliBrowserIdleClose(origin, tracker);
        }
        return;
    }

    let oldest = Infinity;
    for (const lastSeenAt of tracker.pinnedViewers.values()) {
        oldest = Math.min(oldest, Number(lastSeenAt || 0));
    }

    const delay = Math.max(
        1_000,
        oldest + OPENCLI_VOZ_VIEWER_HEARTBEAT_TTL_MS - Date.now() + 250
    );

    tracker.viewerExpiryTimer = setTimeout(() => {
        tracker.viewerExpiryTimer = null;
        const before = tracker.pinnedViewers.size;
        const after = pruneOpenCliBrowserViewerPins(tracker);

        if (before !== after) {
            console.log(
                `[OPENCLI LEASE] Expired ${before - after} stale viewer pin(s) for ${origin}; leases=${after}`
            );
        }

        if (after > 0) {
            scheduleOpenCliBrowserViewerExpiry(origin, tracker);
        } else if (tracker.pending === 0) {
            scheduleOpenCliBrowserIdleClose(origin, tracker);
        }
    }, delay);

    tracker.viewerExpiryTimer.unref?.();
}

async function touchOpenCliPinnedBrowserPage(origin) {
    const state = openCliBrowserFetchStates.get(origin);

    // Heartbeats are keep-alive only. They must never create, navigate,
    // rebind, or replace a browser page. Real fetch work owns creation.
    if (
        !state?.browserReady ||
        !state?.browserLeaseOpen ||
        !state.page?.getActivePage?.()
    ) {
        return false;
    }

    try {
        await evaluateOpenCliSharedBrowserPage(state, 'void 0');
        return true;
    } catch (error) {
        state.browserReady = false;
        state.browserLeaseOpen = false;
        console.warn(
            `[OPENCLI LEASE] Viewer keepalive found stale shared page for ${origin}: ${error instanceof Error ? error.message : String(error)}`
        );
        return false;
    }
}


function maybeDeleteOpenCliBrowserTracker(
    origin,
    tracker
) {
    if (
        tracker.pending === 0 &&
        !tracker.closeTimer &&
        !tracker.closePromise &&
        !tracker.viewerExpiryTimer &&
        !openCliBrowserOriginPinned(tracker) &&
        openCliBrowserFetchQueues.get(origin) ===
            tracker
    ) {
        openCliBrowserFetchQueues.delete(
            origin
        );
    }
}


function scheduleOpenCliBrowserIdleClose(
    origin,
    tracker
) {
    if (!tracker) {
        return;
    }

    cancelOpenCliBrowserIdleClose(
        tracker
    );

    if (
        tracker.pending !== 0 ||
        tracker.closePromise ||
        openCliBrowserOriginPinned(tracker)
    ) {
        return;
    }

    // OPENCLI_FETCH_EXACT_IDLE_CLOSE_V6
    //
    // Keep Browser Bridge's own idle timeout long enough that it cannot reap a
    // VOZ tab while an RSS viewer is pinned. Our policy owns the real 60-second
    // idle lifetime: only when there are no queued/running jobs AND no active
    // viewer do we close the exact owned tab. Closing the exact target avoids
    // the old closeWindow()/lease-release path that produced about:blank tabs.
    tracker.closeTimer = setTimeout(() => {
        tracker.closeTimer = null;

        if (
            tracker.pending !== 0 ||
            tracker.closePromise ||
            openCliBrowserOriginPinned(tracker) ||
            openCliBrowserFetchQueues.get(origin) !== tracker
        ) {
            return;
        }

        const state = openCliBrowserFetchStates.get(origin);
        const closeTask = (async () => {
            if (state) {
                await resetOpenCliBrowserFetchPage(state, {
                    closeTab: true,
                    reason: '60s fetch-idle cleanup'
                });
            }

            console.log(
                `[OPENCLI FETCH] ${origin} idle for 60s; closed exact reusable browser tab`
            );
        })();

        tracker.closePromise = closeTask;

        closeTask.finally(() => {
            if (tracker.closePromise === closeTask) {
                tracker.closePromise = null;
            }

            maybeDeleteOpenCliBrowserTracker(
                origin,
                tracker
            );
        }).catch(() => {});
    }, 60_000);

    tracker.closeTimer.unref?.();
}


function normalizeOpenCliLeaseOrigin(
    url
) {
    const parsed =
        new URL(url);

    if (
        parsed.protocol !== 'http:' &&
        parsed.protocol !== 'https:'
    ) {
        throw new Error(
            'OpenCLI shared-tab lease requires HTTP(S)'
        );
    }

    return parsed.origin;
}


/*
 * Pin an origin LOGICALLY for a UI viewer.
 *
 * OPENCLI_VOZ_LOGICAL_LEASE_ONLY_V2
 *
 * A viewer lease is metadata only. It MUST NOT create, navigate, close,
 * rebind, retain, or otherwise touch a physical OpenCLI/Chromium tab.
 *
 * The shared browser transport is owned exclusively by
 * runOpenCliBrowserFetch(). If/when real VOZ work arrives, that transport
 * creates or reuses the one persistent origin page. Multiple viewers merely
 * share this logical reference count.
 *
 * This avoids a subtle Browser Bridge failure mode where concurrent lease
 * preparation can allocate/release placeholder targets and leave visible
 * about:blank tabs behind even though the fetch transport itself is shared.
 */
export async function acquireOpenCliBrowserOriginLease(
    url,
    viewerId
) {
    const origin =
        normalizeOpenCliLeaseOrigin(
            url
        );

    const normalizedViewerId =
        String(viewerId || '')
            .trim();

    if (
        !normalizedViewerId ||
        normalizedViewerId.length > 160
    ) {
        throw new Error(
            'Invalid OpenCLI lease viewer'
        );
    }

    const tracker =
        getOpenCliBrowserFetchTracker(
            origin
        );

    tracker.pinnedViewers.set(
        normalizedViewerId,
        Date.now()
    );

    // A visible VOZ-only RSS view outranks the 60-second fetch-idle cleanup.
    // Cancel local idle bookkeeping immediately and keep this viewer's stale
    // expiry armed. Each active browser tab has its own viewer id.
    cancelOpenCliBrowserIdleClose(tracker);
    scheduleOpenCliBrowserViewerExpiry(origin, tracker);

    const state = openCliBrowserFetchStates.get(origin);
    const ready = Boolean(
        state?.browserReady &&
        state?.browserLeaseOpen
    );

    // OPENCLI_VOZ_VIEWER_KEEPALIVE_V3
    // The Browser Bridge itself also has a 60-second idle lease. Merely keeping
    // metadata pinned is therefore insufficient: while a VOZ-only RSS view is
    // open, heartbeat requests touch the EXISTING shared page with a no-op.
    // This renews the physical session without navigation/focus changes and
    // without creating a page if the transport has not opened one yet.
    const keptAlive = ready
        ? await touchOpenCliPinnedBrowserPage(origin)
        : false;

    console.log(
        `[OPENCLI LEASE] Pinned/heartbeat viewer for ${origin}; `
        + `viewer=${normalizedViewerId}; `
        + `leases=${tracker.pinnedViewers.size}; `
        + `sharedPageReady=${ready}; `
        + `keptAlive=${keptAlive}`
    );

    return {
        origin,
        active: true,
        reused: ready,
        ready,
        leases:
            tracker.pinnedViewers.size
    };
}


/*
 * Releasing the last UI pin ends only the logical viewer pin. If no fetch
 * work remains, the origin enters the same 60-second warm-idle window. The
 * Browser Bridge idle lease performs physical cleanup; this app does not call
 * closeWindow() on the fetch tab.
 */
export function releaseOpenCliBrowserOriginLease(
    url,
    viewerId
) {
    const origin =
        normalizeOpenCliLeaseOrigin(
            url
        );

    const normalizedViewerId =
        String(viewerId || '')
            .trim();

    const tracker =
        openCliBrowserFetchQueues.get(
            origin
        );

    if (!tracker) {
        return {
            origin,
            active: false,
            leases: 0
        };
    }

    if (!(tracker.pinnedViewers instanceof Map)) {
        const previous = tracker.pinnedViewers;
        tracker.pinnedViewers = new Map();
        if (previous instanceof Set) {
            const now = Date.now();
            for (const existingViewerId of previous) {
                tracker.pinnedViewers.set(existingViewerId, now);
            }
        }
    }

    tracker.pinnedViewers.delete(normalizedViewerId);
    pruneOpenCliBrowserViewerPins(tracker);
    scheduleOpenCliBrowserViewerExpiry(origin, tracker);

    console.log(
        `[OPENCLI LEASE] Released shared browser pin for ${origin}; `
        + `viewer=${normalizedViewerId || 'unknown'}; `
        + `leases=${tracker.pinnedViewers.size}; `
        + `pending=${tracker.pending}`
    );

    /*
     * Running OpenCLI requests are intentionally untouched.
     *
     * If pending > 0, their normal finally() path handles tracker cleanup.
     * Otherwise start/restart the 60-second warm-idle timer.
     */
    if (
        tracker.pending === 0 &&
        !openCliBrowserOriginPinned(
            tracker
        )
    ) {
        scheduleOpenCliBrowserIdleClose(
            origin,
            tracker
        );
    }

    return {
        origin,
        active:
            openCliBrowserOriginPinned(
                tracker
            ),
        leases:
            tracker.pinnedViewers.size,
        pending:
            tracker.pending
    };
}


export function runOpenCliBrowserFetch(url) {
    let origin;

    try {
        origin =
            new URL(url).origin;
    }
    catch {
        return Promise.reject(
            new Error(
                'Invalid URL for OpenCLI browser fetch'
            )
        );
    }

    const tracker =
        getOpenCliBrowserFetchTracker(
            origin
        );

    // OPENCLI_FETCH_REUSE_PER_ORIGIN_EXACT_URL_V3
    // One queue per source/origin. Browser fallback jobs reuse the same tab.
    // For normal sources that tab is navigated to each job's exact URL; VOZ
    // keeps its origin-context fetch optimization. Other origins run independently.
    cancelOpenCliBrowserIdleClose(
        tracker
    );

    tracker.pending += 1;

    const start = async () => {
        // If the 60s idle timer fired at the exact moment this request arrived,
        // wait for that physical release to finish, then reopen/rebind once.
        if (tracker.closePromise) {
            await tracker.closePromise;
        }

        return runOpenCliBrowserFetchNow(
            url
        );
    };

    const task = tracker.tail.then(
        start,
        start
    );

    // A failed request must not poison later work for this origin.
    tracker.tail = task.then(
        () => undefined,
        () => undefined
    );

    return task.finally(() => {
        tracker.pending =
            Math.max(
                0,
                tracker.pending - 1
            );

        if (tracker.pending !== 0) {
            return;
        }

        scheduleOpenCliBrowserIdleClose(
            origin,
            tracker
        );
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

    // OPENCLI_READER_PER_SOURCE_REUSE_60S_V1
    // The normal OpenCLI reader MUST open the exact requested URL, but it no
    // longer needs a fresh physical tab for every article. The caller keeps
    // one background Page per source/origin and command.func() navigates that
    // same Page to kwargs.url for every queued read.
    return read(guardedPage, kwargs, false);
}


// ---------------------------------------------------------------------------
// Normal OpenCLI real-page reader pool
//
// This is deliberately separate from `opencli-fetch` above.
//
//   normal OpenCLI:
//     same source -> one real browser tab -> exact URL A -> exact URL B -> ...
//     source queue is serialized; tab closes after 60 seconds with no work.
//
//   opencli-fetch:
//     keeps its own transport/fallback policy (including VOZ origin-context).
//
// A long-lived child worker owns each source tab so stdout produced by
// `opencli web read --stdout` can be captured without monkey-patching stdout in
// the RSS server process. Different sources can still run independently.
// ---------------------------------------------------------------------------

const OPENCLI_READER_IDLE_MS = 60_000;
const OPENCLI_READER_JOB_TIMEOUT_MS = 60_000;
const openCliReaderPools = new Map();
let openCliReaderJobSequence = 0;

function getOpenCliReaderOrigin(kwargs) {
    const url = String(kwargs?.url || '');
    const parsed = new URL(url);

    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('OpenCLI reader only supports HTTP(S) URLs');
    }

    return parsed.origin;
}

function clearOpenCliReaderPoolIdleTimer(pool) {
    if (!pool?.idleTimer) return;
    clearTimeout(pool.idleTimer);
    pool.idleTimer = null;
}

function clearOpenCliReaderJobTimer(job) {
    if (!job?.timer) return;
    clearTimeout(job.timer);
    job.timer = null;
}

function rejectOpenCliReaderPoolJobs(pool, error) {
    for (const job of pool.jobs.values()) {
        clearOpenCliReaderJobTimer(job);
        job.reject(error);
    }
    pool.jobs.clear();
}

function scheduleOpenCliReaderPoolIdleClose(pool) {
    clearOpenCliReaderPoolIdleTimer(pool);

    if (pool.jobs.size !== 0 || pool.closing) return;

    pool.idleTimer = setTimeout(() => {
        pool.idleTimer = null;
        if (pool.jobs.size !== 0 || pool.closing) return;

        pool.closing = true;
        if (openCliReaderPools.get(pool.origin) === pool) {
            openCliReaderPools.delete(pool.origin);
        }

        console.log(
            `[OPENCLI READER] ${pool.origin} idle for 60s; closing its reusable exact-page tab`
        );

        if (pool.child.connected) {
            pool.child.send({ type: 'shutdown' });
        } else {
            pool.child.kill('SIGTERM');
        }

        pool.forceKillTimer = setTimeout(() => {
            if (!pool.exited) pool.child.kill('SIGTERM');
        }, 5000);
        pool.forceKillTimer.unref?.();
    }, OPENCLI_READER_IDLE_MS);
    pool.idleTimer.unref?.();
}

function createOpenCliReaderPool(origin) {
    const child = fork(
        fileURLToPath(import.meta.url),
        ['--reader-pool-worker', origin],
        { silent: true, execArgv: [] }
    );

    const pool = {
        origin,
        child,
        jobs: new Map(),
        idleTimer: null,
        forceKillTimer: null,
        closing: false,
        exited: false,
        stderrTail: ''
    };

    openCliReaderPools.set(origin, pool);

    child.stdout.on('data', data => {
        // Pooled read results travel over IPC. Anything written directly to
        // stdout is only diagnostic residue; keep a small tail for crashes.
        pool.stderrTail = (pool.stderrTail + String(data)).slice(-1024 * 1024);
    });

    child.stderr.on('data', data => {
        pool.stderrTail = (pool.stderrTail + String(data)).slice(-1024 * 1024);
    });

    child.on('message', message => {
        const jobId = String(message?.jobId || '');
        const job = jobId ? pool.jobs.get(jobId) : null;

        if (message?.type === 'started' && job) {
            clearOpenCliReaderJobTimer(job);
            job.timer = setTimeout(() => {
                if (!pool.jobs.has(jobId)) return;

                pool.jobs.delete(jobId);
                job.reject(new Error('OpenCLI reader failed or timed out.'));

                // A timed-out navigation can leave this one source worker in
                // an unknown page state. Kill only this source; the next read
                // recreates it cleanly.
                pool.closing = true;
                if (openCliReaderPools.get(origin) === pool) {
                    openCliReaderPools.delete(origin);
                }
                child.kill('SIGTERM');
            }, OPENCLI_READER_JOB_TIMEOUT_MS);
            job.timer.unref?.();
            return;
        }

        if (message?.type === 'verification' && job) {
            clearOpenCliReaderJobTimer(job);
            job.timer = setTimeout(() => {
                if (!pool.jobs.has(jobId)) return;
                pool.jobs.delete(jobId);
                job.reject(new Error('OpenCLI reader failed or timed out.'));
                pool.closing = true;
                if (openCliReaderPools.get(origin) === pool) {
                    openCliReaderPools.delete(origin);
                }
                child.kill('SIGTERM');
            }, OPENCLI_READER_JOB_TIMEOUT_MS);
            job.timer.unref?.();

            Promise.resolve()
                .then(() => job.canWait())
                .then(Boolean)
                .catch(() => false)
                .then(allowed => {
                    if (child.connected && pool.jobs.has(jobId)) {
                        child.send({
                            type: 'verification-decision',
                            jobId,
                            allowed
                        });
                    }
                });
            return;
        }

        if (message?.type === 'result' && job) {
            clearOpenCliReaderJobTimer(job);
            pool.jobs.delete(jobId);

            if (message.ok) {
                job.resolve({
                    stdout: String(message.stdout || ''),
                    stderr: String(message.stderr || '')
                });
            } else {
                job.reject(
                    new Error(
                        String(message.error || message.stderr || '').trim()
                        || 'OpenCLI reader failed.'
                    )
                );
            }

            scheduleOpenCliReaderPoolIdleClose(pool);
        }
    });

    child.on('error', error => {
        if (pool.exited) return;
        pool.closing = true;
        if (openCliReaderPools.get(origin) === pool) {
            openCliReaderPools.delete(origin);
        }
        rejectOpenCliReaderPoolJobs(pool, error);
    });

    child.on('close', code => {
        pool.exited = true;
        clearOpenCliReaderPoolIdleTimer(pool);
        if (pool.forceKillTimer) clearTimeout(pool.forceKillTimer);
        if (openCliReaderPools.get(origin) === pool) {
            openCliReaderPools.delete(origin);
        }

        if (pool.jobs.size > 0) {
            const detail = pool.stderrTail.trim();
            rejectOpenCliReaderPoolJobs(
                pool,
                new Error(
                    detail
                    || `OpenCLI reader worker exited${code == null ? '' : ` (${code})`}.`
                )
            );
        }
    });

    console.log(
        `[OPENCLI READER] Created reusable exact-page worker for ${origin}`
    );

    return pool;
}

export function runOpenCliReader(kwargs, canWait = () => false) {
    let origin;

    try {
        origin = getOpenCliReaderOrigin(kwargs);
    } catch (error) {
        return Promise.reject(error);
    }

    let pool = openCliReaderPools.get(origin);
    if (!pool || pool.closing || pool.exited) {
        pool = createOpenCliReaderPool(origin);
    }

    clearOpenCliReaderPoolIdleTimer(pool);

    const jobId = `${process.pid}-${Date.now()}-${++openCliReaderJobSequence}`;

    return new Promise((resolve, reject) => {
        const job = {
            jobId,
            resolve,
            reject,
            canWait,
            timer: null
        };

        pool.jobs.set(jobId, job);

        if (!pool.child.connected) {
            pool.jobs.delete(jobId);
            reject(new Error('OpenCLI reader worker is not connected.'));
            return;
        }

        // Jobs for this source are serialized inside the worker. That keeps
        // exactly one source tab and makes every job navigate that SAME tab to
        // its own exact requested URL.
        pool.child.send({
            type: 'read',
            jobId,
            kwargs
        });
    });
}


if (process.argv[2] === '--reader-pool-worker') {
    const origin = String(process.argv[3] || '');
    let activePage = null;
    let processing = false;
    let shuttingDown = false;
    const queue = [];
    const verificationWaiters = new Map();

    const writeChunkToString = chunk =>
        Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk ?? '');

    const reply = message => {
        if (process.connected) process.send(message);
    };

    const askForVerification = jobId => new Promise(resolve => {
        const timeout = setTimeout(() => {
            verificationWaiters.delete(jobId);
            resolve(false);
        }, 2000);

        verificationWaiters.set(jobId, allowed => {
            clearTimeout(timeout);
            verificationWaiters.delete(jobId);
            resolve(allowed === true);
        });

        reply({ type: 'verification', jobId });
    });

    const closeReaderTabAndExit = async (code = 0) => {
        if (activePage) {
            try {
                // Close the exact owned tab, NOT closeWindow()/lease release.
                // The latter is the path that produced orphan about:blank tabs.
                await activePage.closeTab();
            } catch {
            }
        }

        if (process.connected) process.disconnect();
        process.exit(code);
    };

    const runJob = async (job, command, setDaemonCommandTimeoutSeconds) => {
        const { jobId, kwargs } = job;
        reply({ type: 'started', jobId });

        let stdout = '';
        let stderr = '';
        const originalStdoutWrite = process.stdout.write;
        const originalStderrWrite = process.stderr.write;

        process.stdout.write = function(chunk, encoding, callback) {
            const text = writeChunkToString(chunk);
            if (stdout.length + text.length > 12 * 1024 * 1024) {
                throw new Error('OpenCLI reader output exceeded 12 MB');
            }
            stdout += text;
            if (typeof encoding === 'function') encoding();
            if (typeof callback === 'function') callback();
            return true;
        };

        process.stderr.write = function(chunk, encoding, callback) {
            stderr = (stderr + writeChunkToString(chunk)).slice(-1024 * 1024);
            if (typeof encoding === 'function') encoding();
            if (typeof callback === 'function') callback();
            return true;
        };

        try {
            // Human waiting may be long; individual browser operations must not be.
            setDaemonCommandTimeoutSeconds(20);

            await readWithHumanVerification(
                command.func,
                activePage,
                kwargs,
                () => askForVerification(jobId)
            );

            reply({
                type: 'result',
                jobId,
                ok: true,
                stdout,
                stderr
            });
        } catch (error) {
            reply({
                type: 'result',
                jobId,
                ok: false,
                stdout,
                stderr,
                error: error?.message || String(error)
            });
        } finally {
            process.stdout.write = originalStdoutWrite;
            process.stderr.write = originalStderrWrite;
        }
    };

    const main = async () => {
        let parsedOrigin;
        try {
            parsedOrigin = new URL(origin);
        } catch {
            throw new Error('Invalid OpenCLI reader worker origin');
        }

        const [
            { Page },
            { setDaemonCommandTimeoutSeconds },
            { __test__: { command } }
        ] = await Promise.all([
            import('./browser/opencli-page.js'),
            import('../node_modules/@jackwener/opencli/dist/src/browser/daemon-client.js'),
            import('../node_modules/@jackwener/opencli/clis/web/read.js')
        ]);

        const profile =
            process.env.OPENCLI_BROWSER_PROFILE
            || process.env.OPENCLI_PROFILE
            || undefined;

        const sourceKey =
            `${parsedOrigin.protocol}-${parsedOrigin.host}`
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '');

        // The worker lifetime is the lease. The same Page remembers targetId,
        // so goto(exactUrl) navigates the existing tab instead of allocating a
        // new one for each article. Parent closes this worker after 60s idle.
        activePage = new Page(
            `rss-opencli-reader-${sourceKey}-${process.pid}`,
            3600,
            undefined,
            'background',
            'adapter',
            'persistent',
            profile
        );

        const pump = async () => {
            if (processing) return;
            processing = true;

            try {
                while (queue.length > 0) {
                    const job = queue.shift();
                    await runJob(job, command, setDaemonCommandTimeoutSeconds);
                }
            } finally {
                processing = false;
                if (shuttingDown && queue.length === 0) {
                    await closeReaderTabAndExit(0);
                }
            }
        };

        process.on('message', message => {
            if (message?.type === 'verification-decision') {
                const resolver = verificationWaiters.get(String(message.jobId || ''));
                if (resolver) resolver(message.allowed === true);
                return;
            }

            if (message?.type === 'read') {
                if (shuttingDown) {
                    reply({
                        type: 'result',
                        jobId: String(message.jobId || ''),
                        ok: false,
                        error: 'OpenCLI reader worker is shutting down.'
                    });
                    return;
                }

                queue.push({
                    jobId: String(message.jobId || ''),
                    kwargs: message.kwargs || {}
                });
                void pump();
                return;
            }

            if (message?.type === 'shutdown') {
                shuttingDown = true;
                if (!processing && queue.length === 0) {
                    void closeReaderTabAndExit(0);
                }
            }
        });

        process.on('SIGTERM', () => {
            shuttingDown = true;
            void closeReaderTabAndExit(1);
        });

        reply({ type: 'ready', origin });
    };

    try {
        await main();
    } catch (error) {
        process.stderr.write((error?.message || String(error)) + '\n');
        await closeReaderTabAndExit(1);
    }
}
