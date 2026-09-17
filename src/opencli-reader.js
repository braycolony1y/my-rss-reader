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
// Separate from the existing OpenCLI article reader.
//
// First request for an origin:
//   real Chrome navigation -> wait for usable page -> browser fetch()
//
// Later requests:
//   browser fetch() directly in the persistent Chrome session
//
// If Cloudflare starts blocking browser fetch again:
//   navigate/refresh through Chrome -> wait -> retry browser fetch once
// ---------------------------------------------------------------------------

const openCliBrowserFetchStates = new Map();
const openCliBrowserFetchQueues = new Map();

const openCliBrowserFetchSleep = ms =>
    new Promise(resolve => setTimeout(resolve, ms));

function isOpenCliBrowserFetchChallenge(status, html = '') {
    return status === 403
        || status === 429
        || /Just a moment|cf-chl-|Enable JavaScript and cookies|Checking your browser|Verifying you are human/i
            .test(String(html));
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

    // This method runs in the main RSS process. The existing OpenCLI reader
    // runs in its own fork, so this does not alter its worker timeout.
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

    const page = new Page(
        session,        // session
        60,             // idle timeout
        undefined,      // contextId
        'background',   // windowMode
        'browser',      // surface
        'persistent',   // siteSession
        profile         // preferredContextId / OpenCLI profile alias
    );

    state = {
        origin,
        page,
        initialized: false,
        refreshedAt: 0
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
                        /Just a moment|cf-chl-|Enable JavaScript and cookies|Checking your browser|Verifying you are human/i
                            .test(html)
                };
            })()`);

            if (
                last
                && !last.challenge
                && last.readyState !== 'loading'
                && Number(last.size || 0) > 1000
            ) {
                // Give Cloudflare's post-load JS a short moment to finish
                // establishing browser/session state.
                await openCliBrowserFetchSleep(750);
                return last;
            }
        } catch {
            // Challenge pages may navigate/reload while we poll.
        }

        await openCliBrowserFetchSleep(500);
    }

    throw new Error(
        'OpenCLI browser navigation did not become usable'
        + (last?.title ? `: ${last.title}` : '')
    );
}

async function refreshOpenCliBrowserFetchSession(state, url) {
    console.log(
        `[OPENCLI FETCH] Refreshing browser session for ${state.origin}`
    );

    await state.page.goto(url, {
        settleMs: 2000
    });

    await waitForOpenCliBrowserUsablePage(state.page);

    state.initialized = true;
    state.refreshedAt = Date.now();
}

async function openCliBrowserFetchOnce(state, url) {
    const result = await state.page.evaluate(
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

async function runOpenCliBrowserFetchNow(url) {
    const parsed = new URL(url);

    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error(
            'OpenCLI browser fetch only supports HTTP(S) URLs'
        );
    }

    const state = await getOpenCliBrowserFetchState(url);

    // First request establishes a working real-browser session.
    if (!state.initialized) {
        await refreshOpenCliBrowserFetchSession(state, url);
    }

    let result;

    try {
        result = await openCliBrowserFetchOnce(state, url);
    } catch (error) {
        // Browser/tab/session may have become stale.
        console.warn(
            `[OPENCLI FETCH] Browser fetch failed; refreshing ${state.origin}: ${error.message}`
        );

        state.initialized = false;
        await refreshOpenCliBrowserFetchSession(state, url);
        result = await openCliBrowserFetchOnce(state, url);
    }

    if (isOpenCliBrowserFetchChallenge(result.status, result.html)) {
        console.warn(
            `[OPENCLI FETCH] Verification returned for ${state.origin}; refreshing`
        );

        state.initialized = false;
        await refreshOpenCliBrowserFetchSession(state, url);

        result = await openCliBrowserFetchOnce(state, url);
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

export function runOpenCliBrowserFetch(url) {
    let origin;

    try {
        origin = new URL(url).origin;
    } catch {
        return Promise.reject(
            new Error('Invalid URL for OpenCLI browser fetch')
        );
    }

    // Serialize requests per origin because session refresh navigates the
    // shared Chrome page.
    const previous =
        openCliBrowserFetchQueues.get(origin)
        || Promise.resolve();

    const task = previous.then(
        () => runOpenCliBrowserFetchNow(url),
        () => runOpenCliBrowserFetchNow(url)
    );

    const gate = task.then(
        () => undefined,
        () => undefined
    );

    openCliBrowserFetchQueues.set(origin, gate);

    return task.finally(() => {
        if (openCliBrowserFetchQueues.get(origin) === gate) {
            openCliBrowserFetchQueues.delete(origin);
        }
    });
}

export async function readWithHumanVerification(read, page, kwargs, canWait) {
    let prompted = false;
    const guardedPage = new Proxy(page, {
        get(target, key) {
            if (key !== 'evaluate') {
                const value = target[key];
                return typeof value === 'function' ? value.bind(target) : value;
            }
            return async (...args) => {
                let data = await target.evaluate(...args);
                while (isVerificationPage(data)) {
                    if (!await canWait()) throw new Error('Publisher verification blocked this fetch.');
                    if (!prompted) {
                        prompted = true;
                        await target.cdp?.('Page.bringToFront').catch(() => {});
                    }
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
        // Only the currently viewed article can wait above. All other paths
        // release their own tab, including navigation away during a CAPTCHA.
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
