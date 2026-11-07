import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { startUsageFixture } from './usage-fixture.mjs';
import { installSurfaceProbe } from './surface-probe.mjs';
import { surfaces, openSurface, closeSurface, startSurfaceWorkload } from './surface-scenarios.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = process.env.SURFACE_OUTPUT || '/tmp/ai-modal-usage/surfaces';
const seconds = Number(process.env.SURFACE_SECONDS || 6);
const width = Number(process.env.SURFACE_WIDTH || 1100);
const only = process.env.SURFACE_ONLY;
await mkdir(output, { recursive: true });
const fixture = await startUsageFixture();
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const results = [];
try {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    await context.addCookies([{ name: 'auth', value: 'true', url: fixture.url }]);
    await context.addInitScript(() => localStorage.setItem('theme', 'glass-light'));
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(fixture.url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.Alpine && Alpine.$data(document.body).articles?.length);
    for (const surface of surfaces.filter(s => !only || only.split(',').includes(s.name))) {
        const errorStart = errors.length;
        await page.evaluate(openSurface, surface);
        await page.waitForFunction(selector => getComputedStyle(document.querySelector(selector)).display !== 'none', surface.selector);
        await page.waitForFunction(surface => {
            const root = document.querySelector(surface.selector);
            const panel = surface.panelSelector ? root.querySelector(surface.panelSelector) : root.firstElementChild;
            return Number(getComputedStyle(panel).opacity) === 1 && !panel._x_transitioning;
        }, surface);
        await page.evaluate(installSurfaceProbe, surface);
        await page.evaluate(startSurfaceWorkload, { surface, seconds });
        // Bounded calls keep the runner observable during the real-interval soak.
        for (let elapsed = 0; elapsed < seconds; elapsed += 5) {
            await page.waitForTimeout(Math.min(5, seconds - elapsed) * 1000);
            console.log(JSON.stringify({ surface: surface.name, elapsed: Math.min(elapsed + 5, seconds) }));
        }
        await page.evaluate(() => stopSurfaceWorkload());
        const observation = await page.evaluate(() => surfaceProbe.stop());
        const result = { name: surface.name, width, seconds, errors: errors.slice(errorStart), ...observation };
        results.push(result);
        await page.screenshot({ path: `${output}/${surface.name}.png` });
        await page.evaluate(closeSurface, surface);
        await page.waitForFunction(selector => getComputedStyle(document.querySelector(selector)).display === 'none', surface.selector);
        await writeFile(`${output}/report.json`, JSON.stringify(results, null, 2));
    }
    for (const r of results) {
        assert.deepEqual(r.errors, [], `${r.name}: page errors`);
        assert.deepEqual(r.failures, [], `${r.name}: per-frame visibility failures`);
        assert.deepEqual(r.removals, [], `${r.name}: removed shell`);
        assert.deepEqual(r.stateChanges, [], `${r.name}: unexpected state change`);
        assert.equal(r.sameRoot, true);
    }
} finally {
    await writeFile(`${output}/report.json`, JSON.stringify(results, null, 2));
    await browser.close(); fixture.close();
}
