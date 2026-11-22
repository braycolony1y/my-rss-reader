import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { startUsageFixture } from './usage-fixture.mjs';
import { installUsageProbe } from './usage-probe.mjs';
import { regionPixels, scoreFrame } from './usage-frames.mjs';

const { chromium, webkit, firefox } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const engine = process.env.USAGE_ENGINE || 'chromium';
const output = process.env.USAGE_OUTPUT || '/tmp/ai-modal-usage/baseline';
const seconds = Number(process.env.USAGE_SECONDS || 65);
const accelerated = process.env.USAGE_ACCELERATED === '1';
const width = Number(process.env.USAGE_WIDTH || 1100);
const capture = engine === 'chromium' && process.env.USAGE_CAPTURE !== '0';
const races = process.env.USAGE_RACES === '1';
await mkdir(`${output}/frames`, { recursive: true });
const server = await startUsageFixture();
const browser = await ({ chromium, webkit, firefox }[engine]).launch({ headless: true,
    ...(engine === 'chromium' ? { args: ['--no-sandbox', '--disable-dev-shm-usage'] } : {}) });
const report = { engine, version: browser.version(), seconds, accelerated, width,
    capture, races, frames: [], errors: [], requestTimes: [], layers: [], paintEvents: 0 };
let context, client, frameWork = Promise.resolve();
try {
    context = await browser.newContext({ viewport: { width, height: 1000 },
        ...(width < 600 && engine !== 'firefox' ? { isMobile: true, hasTouch: true } : {}) });
    await context.addCookies([{ name: 'auth', value: 'true', url: server.url }]);
    await context.addInitScript(({ accelerated, races }) => {
        localStorage.setItem('theme', 'glass-light');
        if (accelerated) {
            const original = window.setInterval;
            window.setInterval = (fn, ms, ...args) => original(fn,
                [2000, 5000, 60000].includes(ms) ? ms / 20 : ms, ...args);
        }
        if (races) {
            const originalFetch = window.fetch;
            let sequence = 0;
            window.fetch = async function (input, options) {
                const url = typeof input === 'string' ? input : input.url;
                const observed = /\/api\/(smart-status|summary\/debug)/.test(url);
                const delay = observed && ++sequence % 3 === 0 ? 850 : 5;
                const response = await originalFetch.call(this, input, options);
                if (!observed) return response;
                const snapshot = await response.text();
                await new Promise(resolve => setTimeout(resolve, delay));
                return new Response(snapshot, { status: response.status, headers: response.headers });
            };
        }
    }, { accelerated, races });
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('crash', () => report.errors.push('Browser page crashed'));
    page.on('request', request => {
        if (/api\/(smart-status|summary\/debug|online-ai-usage|data)/.test(request.url()))
            report.requestTimes.push({ at: Date.now(), url: new URL(request.url()).pathname });
    });
    await page.goto(server.url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.Alpine && Alpine.$data(document.body).articles?.length);
    const originalRoot = await page.locator('.ai-status-overlay').elementHandle();
    const openUsage = async () => {
        if (width < 768) await page.evaluate(() => { Alpine.$data(document.body).mobileSidebarOpen = true; });
        await page.locator('aside li').filter({ hasText: 'AI Usage & Keys' }).click();
    };
    await openUsage();
    await page.waitForFunction(() => Alpine.$data(document.body).onlineAiUsage?.events?.length);
    await page.waitForTimeout(300);
    if (process.env.USAGE_NO_BLUR === '1') await page.addStyleTag({ content:
        '.ai-status-overlay { backdrop-filter:none!important; -webkit-backdrop-filter:none!important; }' });
    const regions = await page.evaluate(() => ['.ai-status-header', '.ai-status-footer'].map(selector => {
        const r = document.querySelector(selector).getBoundingClientRect();
        const top = Math.max(0, Math.ceil(r.top + 4));
        return { left: Math.max(0, Math.ceil(r.left + 4)), top,
            width: Math.floor(r.width - 8), height: Math.floor(Math.min(r.bottom - 4, innerHeight) - top) };
    }).concat([{ left: 2, top: 300, width: 12, height: 100 }]));
    const visibleBuffer = await page.screenshot({ path: `${output}/open.png` });
    await page.evaluate(() => document.querySelector('.ai-status-overlay').style.visibility = 'hidden');
    const absentBuffer = await page.screenshot({ path: `${output}/absent-reference.png` });
    await page.evaluate(() => document.querySelector('.ai-status-overlay').style.removeProperty('visibility'));
    // Flush the deliberate hidden-reference paint before observing production
    // behavior. Screencast can otherwise deliver that stale reference first.
    await page.screenshot({ path: `${output}/restored.png` });
    const visible = await regionPixels(visibleBuffer, regions), absent = await regionPixels(absentBuffer, regions);
    if (capture) {
        client = await context.newCDPSession(page);
        await client.send('LayerTree.enable');
        client.on('LayerTree.layerTreeDidChange', event => {
            if (report.layers.length < 1000) report.layers.push({ at: Date.now(), count: event.layers?.length });
        });
        client.on('LayerTree.layerPainted', () => report.paintEvents++);
        client.on('Page.screencastFrame', event => {
            const id = report.frames.length;
            // ACK immediately; image processing must not pace the browser.
            client.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
            const buffer = Buffer.from(event.data, 'base64');
            const item = { id, timestamp: event.metadata.timestamp };
            report.frames.push(item);
            frameWork = frameWork.then(async () => {
                Object.assign(item, scoreFrame(await regionPixels(buffer, regions), visible, absent));
                await writeFile(`${output}/frames/${String(id).padStart(5, '0')}.jpg`, buffer);
            });
        });
        await client.send('Page.startScreencast', { format: 'jpeg', quality: 75, everyNthFrame: 1 });
    }
    await page.locator('.ai-key-input').fill('unsaved-fixture-input');
    await page.evaluate(installUsageProbe);
    // Timer-paced workload avoids waiting on each wheel acknowledgement on a
    // software renderer. Production poll timers remain unchanged in real mode.
    await page.evaluate(({ seconds }) => {
        const app = Alpine.$data(document.body), body = document.querySelector('.ai-status-body');
        const started = performance.now();
        const scroll = setInterval(() => {
            const elapsed = (performance.now() - started) / 1000;
            if (elapsed > seconds) return clearInterval(scroll);
            if (elapsed < seconds / 3) body.scrollTop = 300 + Math.sin(elapsed / 3) * 100;
            else if (elapsed < seconds * 2 / 3) body.scrollTop = 500 + Math.sin(elapsed * 2) * 450;
            // Final third stays stationary for an explicit scroll preservation check.
        }, 50);
        window.usageFeedTimer = setInterval(() => app.fetchData(false, true, true), 7000);
        window.usageScrollTimer = scroll;
    }, { seconds });
    for (let elapsed = 0; elapsed < seconds; elapsed += 5) {
        await page.waitForTimeout(Math.min(5, seconds - elapsed) * 1000);
        const sample = await page.evaluate(() => ({ frames: usageProbe.report.frames,
            failures: usageProbe.report.failures.length, top: document.querySelector('.ai-status-body').scrollTop }));
        console.log(JSON.stringify({ elapsed: Math.min(elapsed + 5, seconds), ...sample, captures: report.frames.length }));
    }
    report.probe = await page.evaluate(() => {
        clearInterval(window.usageFeedTimer); clearInterval(window.usageScrollTimer);
        return usageProbe.stop();
    });
    const top = await page.locator('.ai-status-body').evaluate(node => node.scrollTop);
    await page.evaluate(async () => { const a = Alpine.$data(document.body);
        await Promise.all([a.fetchOnlineAiUsage(true), a.fetchGeminiDebugStats(), a.fetchSmartAiProgress()]); });
    report.stationaryScroll = { before: top, after: await page.locator('.ai-status-body').evaluate(n => n.scrollTop) };
    if (client) await client.send('Page.stopScreencast');
    await frameWork;
    await page.screenshot({ path: `${output}/end.png` });
    await page.locator('.ai-status-close').click();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.ai-status-overlay')).display === 'none');
    await openUsage();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.ai-status-overlay')).display !== 'none');
    report.reopen = await page.evaluate(originalRoot => ({ closed: true,
        open: Alpine.$data(document.body).geminiStatusOpen,
        sameRoot: originalRoot === document.querySelector('.ai-status-overlay'),
        draft: Alpine.$data(document.body).newGeminiKey }), originalRoot);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.ai-status-overlay')).display === 'none');
    report.escapeClosed = true;
    await openUsage();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.ai-status-overlay')).display !== 'none');
    await page.mouse.click(1, 500);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.ai-status-overlay')).display === 'none');
    report.outsideClosed = true;
    assert.deepEqual(report.errors, []);
    assert.equal(report.probe.failures.length, 0, 'Per-frame visibility/focus failure');
    assert.equal(report.probe.replacements.length, 0, 'Shell removed or reinserted');
    assert.equal(report.probe.openChanges.length, 0, 'Visibility state changed during polling');
    assert.equal(report.frames.filter(f => f.disappearance).length, 0, 'Painted overlay disappeared');
    assert.equal(report.stationaryScroll.before, report.stationaryScroll.after);
    assert.ok(report.probe.generated > 1, 'Provider data did not refresh');
    if (seconds >= 60 || accelerated) assert.ok(report.probe.usage > 1, 'Activity data did not refresh');
    assert.deepEqual(report.reopen, { closed: true, open: true, sameRoot: true, draft: 'unsaved-fixture-input' });
    report.passed = true;
} catch (error) {
    report.failure = error.stack;
    process.exitCode = 1;
} finally {
    await frameWork.catch(error => { report.frameFailure = String(error); });
    await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ output, passed: report.passed, failure: report.failure,
        frames: report.frames.length, disappearances: report.frames.filter(f => f.disappearance).length }));
    await browser.close(); server.close();
}
