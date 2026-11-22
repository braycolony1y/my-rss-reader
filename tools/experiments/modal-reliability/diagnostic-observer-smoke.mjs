import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { startDiagnosticServer } from './diagnostic-server.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = process.env.DIAGNOSTIC_OUTPUT || '/tmp/modal-diagnostic-observer';
await mkdir(output, { recursive: true });
const server = await startDiagnosticServer({ enabled: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
    await page.addInitScript(() => localStorage.setItem('theme', 'glass-light'));
    await page.goto(server.url + '/?flicker=nobackdrop&observe=1', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.Alpine && Alpine.$data(document.body).articles?.length);
    await page.addStyleTag({ content: 'html::before { content:""; position:fixed; inset:0; pointer-events:none; backdrop-filter:blur(2px)!important; -webkit-backdrop-filter:blur(2px)!important; }' });
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement, '::before').backdropFilter), 'none');
    await page.locator('aside li').filter({ hasText: 'AI Usage & Keys' }).click();
    await page.waitForFunction(() => __flickerDiagnostic.export().records.some(r => r.type === 'animation-frame-state' && r.surfaces.some(s => s.selector === '.ai-status-overlay' && s.layers.length === 1)));
    assert.equal(await page.evaluate(() => __flickerDiagnostic.verifyFilters().passed), true);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !Alpine.$data(document.body).geminiStatusOpen);
    await page.locator('.article-card h2').first().click();
    await page.waitForFunction(() => Alpine.$data(document.body).overlayContent && !Alpine.$data(document.body).isLoadingOverlay);
    await page.waitForFunction(() => __flickerDiagnostic.export().records.some(r => r.type === 'animation-frame-state'
        && r.surfaces.some(s => s.selector === '.article-overlay-root' && s.layers.length === 2) && r.shared.length === 4));
    const observations = await page.evaluate(() => __flickerDiagnostic.export());
    await writeFile(`${output}/observations.json`, JSON.stringify(observations, null, 2));
    await page.evaluate(() => __flickerDiagnostic.restoreBaseline());
    await page.waitForURL(url => !url.searchParams.has('flicker') && !url.searchParams.has('observe'));
    await page.waitForFunction(() => window.__flickerDiagnostic?.selected === 'baseline' && window.Alpine && Alpine.$data(document.body).articles?.length);
    const restored = await page.evaluate(() => ({ mode: __flickerDiagnostic.selected,
        observe: __flickerDiagnostic.export().observe, styles: document.querySelectorAll('style[data-flicker-diagnostic]').length }));
    assert.deepEqual(restored, { mode: 'baseline', observe: false, styles: 0 });
    console.log(JSON.stringify({ passed: true, modalLayersObserved: ['AI root/panel', 'article root/panel/backdrop'], rootPseudoVerified: true, restored }));
} finally { await browser.close(); server.close(); }
