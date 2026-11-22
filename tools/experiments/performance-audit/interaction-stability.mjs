import {chromium, webkit} from 'playwright';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {startFixtureServer} from '../../../test/helpers/frontend-refactor/server.js';
import {interactionScenarios} from './interaction-stability-scenarios.mjs';
import {nativeRefreshStress, openScrollStress, finishResizeStress} from './interaction-stress.mjs';

export async function runInteractionStability({output, baseline = '', engine = 'chromium'}) {
    await mkdir(output, {recursive: true});
    const server = await startFixtureServer({imageDelayMs: 120});
    const browser = await ({chromium, webkit}[engine]).launch({headless: true,
        ...(engine === 'chromium' ? {args: ['--no-sandbox']} : {})});
    const results = [];
    try {
        for (const mobile of [false, true]) for (const theme of ['classic', 'glass-light']) {
            const context = await browser.newContext({viewport: {width: mobile ? 390 : 1440, height: 900},
                ...(engine === 'chromium' ? {isMobile: mobile, hasTouch: mobile} : {})});
            await context.addCookies([{name: 'auth', value: 'true', url: server.url}]);
            await context.addInitScript(theme => localStorage.setItem('theme', theme), theme);
            if (baseline) {
                const body = await readFile(baseline + '/rendered.js', 'utf8');
                const html = await readFile(baseline + '/rendered.html', 'utf8');
                await context.route('**/script.js*', route => route.fulfill({contentType: 'text/javascript',
                    body}));
                await context.route(server.url + '/', route => route.fulfill({contentType: 'text/html', body: html}));
            }
            const page = await context.newPage(), errors = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.goto(server.url);
            await page.waitForFunction(() => window.Alpine && Alpine.$data(document.body).articles.length
                && !Alpine.$data(document.body).isLoadingArticles);
            const result = await page.evaluate(interactionScenarios);
            if (!baseline) {
                result.nativeRefresh = await page.evaluate(nativeRefreshStress);
                result.scrollRefresh = await page.evaluate(openScrollStress);
                await page.setViewportSize({width: mobile ? 430 : 1280, height: 820});
                result.resize = await page.evaluate(finishResizeStress);
            }
            await page.screenshot({path: `${output}/${engine}-${mobile ? 'mobile' : 'desktop'}-${theme}.png`});
            results.push({engine, mobile, theme, baseline: Boolean(baseline), errors, ...result});
            await writeFile(`${output}/${engine}.json`, JSON.stringify(results, null, 2));
            console.log(JSON.stringify({engine, mobile, theme, sameDestination: result.sameDestination,
                foregroundRefresh: result.foregroundRefresh, blankCloseFrames: result.close.blankVisibleFrames,
                reopen: result.reopen, historyRace: result.historyRace, errors}));
            if (!baseline && (errors.length || result.close.blankVisibleFrames || !result.close.clearedAfterHidden
                || result.sameDestination.counts.some(count => count !== 8) || result.sameDestination.reused !== 8
                || result.foregroundRefresh.waitingCards !== 8 || result.foregroundRefresh.reused !== 8
                || !result.reopen.correctArticle || !result.reopen.textLength || result.historyRace.overlayOpen
                || result.nativeRefresh.waitingCards !== 8 || result.nativeRefresh.reused !== 8 || !result.nativeRefresh.freshProxyRetains
                || !result.scrollRefresh.contentUnchanged || result.scrollRefresh.scrollBefore !== result.scrollRefresh.scrollAfter
                || !result.resize.open || !result.resize.readable || !result.resize.samePanel)) {
                throw Error('Interaction stability regression');
            }
            await context.close();
        }
    } finally { await browser.close(); server.close(); }
    return results;
}

if (process.argv[1]?.endsWith('/interaction-stability.mjs')) {
    await runInteractionStability({output: process.argv[2],
        baseline: process.argv.find(arg => arg.startsWith('--baseline='))?.slice(11) || '',
        engine: process.argv.includes('--webkit') ? 'webkit' : 'chromium'});
}
