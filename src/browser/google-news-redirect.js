import { fileURLToPath, pathToFileURL } from 'node:url';
import { createConcurrencyLimiter } from '../runtime/concurrency-limiter.js';
import { cleanGoogleNewsDestination, googleNewsArticleId, googleNewsTransientError, googleNewsWallError, isRejectedGoogleNewsDestination } from '../articles/google-news-decode.js';

const browserLimiter = createConcurrencyLimiter(1, { maxPending: 16 });

export const runGoogleNewsBrowserTask = task => browserLimiter.run(task);

// A separate process bounds daemon commands without changing the timeout of
// other readers using OpenCLI in the server process.
export function runGoogleNewsBrowserRedirect(url, execFileAsync) {
    return runGoogleNewsBrowserTask(async () => {
        const { stdout } = await execFileAsync(process.execPath, [fileURLToPath(import.meta.url), url], {
            timeout: 40000, maxBuffer: 128 * 1024
        });
        const result = JSON.parse(stdout.trim());
        if (result.wall) throw googleNewsTransientError(result.wall);
        return result.permanentFailure ? { permanentFailure: true } : cleanGoogleNewsDestination(result.url);
    });
}

export async function resolveGoogleNewsBrowserRedirect(url, { createPage, timeoutMs = 18000,
    now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
    if (!googleNewsArticleId(url)) return '';
    if (!createPage) {
        const [{ Page }, { setDaemonCommandTimeoutSeconds }] = await Promise.all([
            import('./opencli-page.js'),
            import('../../node_modules/@jackwener/opencli/dist/src/browser/daemon-client.js')
        ]);
        setDaemonCommandTimeoutSeconds(5);
        createPage = () => new Page('rss-google-news-redirect', 60, undefined,
            'background', 'browser', 'persistent', process.env.OPENCLI_BROWSER_PROFILE || process.env.OPENCLI_PROFILE || undefined);
    }
    const page = createPage();
    const deadline = now() + timeoutMs;
    let target;
    let failure;
    const bounded = (operation, limit = Math.max(1, Math.min(5000, deadline - now()))) => {
        let timer;
        return Promise.race([operation, new Promise((_, reject) => {
            timer = setTimeout(() => reject(Error('OpenCLI redirect timed out')), limit);
        })]).finally(() => clearTimeout(timer));
    };
    async function readLocation(limit) {
        const navigation = await bounded(page.evaluate(() => ({
            url: location.href,
            status: performance.getEntriesByType('navigation')[0]?.responseStatus
        })), limit);
        const locationUrl = typeof navigation === 'string' ? navigation : navigation?.url;
        const wall = googleNewsWallError(locationUrl, navigation?.status);
        if (wall) throw googleNewsTransientError(wall);
        return locationUrl;
    }
    try {
        // Bind a new automation tab explicitly; never navigate a user's tab.
        const opening = page.newTab(url);
        try { target = await bounded(opening, 8000); }
        catch (error) {
            // A late acknowledgment can still carry the tab ID needed for cleanup.
            target = await bounded(opening, 10000).catch(() => undefined);
            throw error;
        }
        if (!target) throw Error('OpenCLI did not create a redirect tab');
        page.setActivePage(target);
        while (now() < deadline) {
            const destination = cleanGoogleNewsDestination(await readLocation());
            if (destination) return destination;
            await sleep(Math.min(400, Math.max(0, deadline - now())));
        }
        const finalUrl = await readLocation(1000);
        return isRejectedGoogleNewsDestination(finalUrl) ? { permanentFailure: true } : cleanGoogleNewsDestination(finalUrl);
    } catch (error) {
        failure = error;
        throw error;
    } finally {
        // Cleanup has its own deadline, even after the polling window expires.
        if (target) await bounded(page.closeTab(target), 7000).catch(error => { if (!failure) throw error; });
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    resolveGoogleNewsBrowserRedirect(process.argv[2])
        .then(result => process.stdout.write(JSON.stringify(typeof result === 'string' ? { url: result } : result)))
        .catch(error => {
            if (error.code === 'GOOGLE_NEWS_WALL') process.stdout.write(JSON.stringify({ wall: error.message }));
            else { console.error(error.message); process.exitCode = 1; }
        });
}
