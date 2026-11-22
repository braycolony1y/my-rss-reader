import { fileURLToPath, pathToFileURL } from 'node:url';
import { withBrowserFetchBudget } from './work-budget.js';
import { createConcurrencyLimiter } from '../runtime/concurrency-limiter.js';
import { cleanGoogleNewsDestination, googleNewsArticleId } from '../articles/google-news-decode.js';

const browserLimiter = createConcurrencyLimiter(1, { maxPending: 16 });

export const runGoogleNewsBrowserTask = task => browserLimiter.run(() => withBrowserFetchBudget(task, 3));

// A separate process bounds daemon commands without changing the timeout of
// other readers using OpenCLI in the server process.
export function runGoogleNewsBrowserRedirect(url, execFileAsync) {
    return runGoogleNewsBrowserTask(async () => {
        const { stdout } = await execFileAsync(process.execPath, [fileURLToPath(import.meta.url), url], {
            timeout: 40000, maxBuffer: 128 * 1024
        });
        return cleanGoogleNewsDestination(JSON.parse(stdout.trim()).url);
    });
}

export async function resolveGoogleNewsBrowserRedirect(url, { createPage, timeoutMs = 20000,
    now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
    if (!googleNewsArticleId(url)) return '';
    if (!createPage) {
        const [{ Page }, { setDaemonCommandTimeoutSeconds }] = await Promise.all([
            import('./opencli-page.js'),
            import('../../node_modules/@jackwener/opencli/dist/src/browser/daemon-client.js')
        ]);
        setDaemonCommandTimeoutSeconds(5);
        createPage = () => new Page('rss-google-news-redirect-' + process.pid, 60, undefined,
            'background', 'browser', 'persistent', process.env.OPENCLI_BROWSER_PROFILE || process.env.OPENCLI_PROFILE || undefined);
    }
    const page = createPage();
    const deadline = now() + timeoutMs;
    let target;
    const bounded = (operation, limit = Math.max(1, Math.min(5000, deadline - now()))) => {
        let timer;
        return Promise.race([operation, new Promise((_, reject) => {
            timer = setTimeout(() => reject(Error('OpenCLI redirect timed out')), limit);
        })]).finally(() => clearTimeout(timer));
    };
    try {
        // Bind a new automation tab explicitly; never navigate a user's tab.
        let timedOut = false;
        const opening = page.newTab(url).then(async id => {
            if (timedOut && id) await bounded(page.closeTab(id), 4000);
            return id;
        });
        try { target = await bounded(opening); }
        catch (error) { timedOut = true; throw error; }
        if (!target) throw Error('OpenCLI did not create a redirect tab');
        page.setActivePage(target);
        while (now() < deadline) {
            const location = await bounded(page.evaluate('location.href'));
            const destination = cleanGoogleNewsDestination(location);
            if (destination) return destination;
            if (/^https?:\/\/(?:consent|accounts)\.google\.|\/sorry\//i.test(location)) return '';
            await sleep(400);
        }
        return '';
    } finally {
        if (target) await bounded(page.closeTab(target), 4000);
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    resolveGoogleNewsBrowserRedirect(process.argv[2])
        .then(url => process.stdout.write(JSON.stringify({ url })))
        .catch(error => { console.error(error.message); process.exitCode = 1; });
}
