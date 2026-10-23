import { mkdir, writeFile } from 'node:fs/promises';
import { startModalFixture } from './fixture.mjs';
import { installModalProbe } from './probe.mjs';

const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = process.env.MODAL_OUTPUT || '/tmp/modal-reliability-evidence/before';
await mkdir(output, {recursive: true});
const server = await startModalFixture();
const engine = process.env.MODAL_ENGINE || 'chromium';
const browser = await (engine === 'webkit' ? webkit : chromium).launch({headless: true,
    ...(engine === 'webkit' ? {executablePath: process.env.WEBKIT_EXECUTABLE} : {args: ['--no-sandbox']})});
try {
    const context = await browser.newContext({viewport: {width: +(process.env.MODAL_WIDTH || 1440), height: 1000}});
    await context.addCookies([{name: 'auth', value: 'true', url: server.url}]);
    await context.addInitScript(() => localStorage.setItem('theme', 'glass-light'));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(server.url);
    await page.waitForFunction(() => window.Alpine && Alpine.$data(document.body).articles?.length);
    await page.waitForTimeout(600);
    // Keep keyboard focus in the feed, as it is when a shortcut/programmatic action opens a modal.
    await page.evaluate(() => {const sc = document.getElementById('scroll-container'); sc.tabIndex = 0; sc.focus(); sc.scrollTop = 300; Alpine.$data(document.body).openGeminiStatus();});
    await page.waitForTimeout(600);
    const before = await page.evaluate(() => {
        const r = document.querySelector('.ai-status-overlay');
        return {feedTop: document.getElementById('scroll-container').scrollTop, focus: document.activeElement.id,
            filters: [r, ...r.querySelectorAll('*')].filter(e => e.getClientRects().length && getComputedStyle(e).backdropFilter !== 'none').map(e => ({tag: e.tagName, class: e.className, filter: getComputedStyle(e).backdropFilter})),
            ancestors: [r.parentElement, document.documentElement].map(e => ({tag:e.tagName,transform:getComputedStyle(e).transform,filter:getComputedStyle(e).filter,contain:getComputedStyle(e).contain}))};
    });
    await page.keyboard.press('PageDown');
    await page.waitForTimeout(400);
    before.feedAfterPageDown = await page.locator('#scroll-container').evaluate(e => e.scrollTop);
    await page.screenshot({path: `${output}/ai-top.png`});
    let client, layers = [], paints = 0;
    if (engine === 'chromium') {
        client = await context.newCDPSession(page);
        await client.send('Performance.enable');
        await client.send('LayerTree.enable');
        client.on('LayerTree.layerTreeDidChange', e => layers.push(e.layers?.length || 0));
        client.on('LayerTree.layerPainted', () => paints++);
    }
    const metricsBefore = client ? await client.send('Performance.getMetrics') : null;
    await page.evaluate(installModalProbe);
    await page.mouse.move(700, 500);
    const started = Date.now();
    for (let i = 0; i < +(process.env.MODAL_STEPS || 80); i++) {
        await page.mouse.wheel(0, (Math.floor(i / 8) % 2 ? -1 : 1) * (i % 3 ? 620 : 120));
        if (i % 10 === 0) await page.evaluate(() => Alpine.$data(document.body).fetchOnlineAiUsage(true));
        if (i % 8 === 0) await page.screenshot({path: `${output}/scroll-${i}.png`});
        await page.waitForTimeout(45);
    }
    const observation = await page.evaluate(() => window.modalProbe.stop());
    const metricsAfter = client ? await client.send('Performance.getMetrics') : null;
    const stable = await page.evaluate(async () => {const r=document.querySelector('.ai-status-overlay'), b=r.querySelector('.ai-status-body'); b.scrollTop=400; const top=b.scrollTop; await Alpine.$data(document.body).fetchOnlineAiUsage(true); await new Promise(r=>setTimeout(r,100)); return {sameRoot:r===document.querySelector('.ai-status-overlay'),sameBody:b===r.querySelector('.ai-status-body'),top,after:b.scrollTop};});
    const report = {engine,version:browser.version(),before,stable,seconds:(Date.now()-started)/1000,observation,metricsBefore,metricsAfter,layers,paints,errors};
    await writeFile(`${output}/report.json`, JSON.stringify(report,null,2));
    console.log(JSON.stringify({output,filters:before.filters.length,feed:[before.feedTop,before.feedAfterPageDown],stable,seconds:report.seconds,frames:observation.frames.length,hidden:observation.hidden,removals:observation.removals,errors:errors.slice(0,5)}));
} finally {await browser.close();server.close();}
