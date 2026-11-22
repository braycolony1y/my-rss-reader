import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { startDiagnosticServer } from './diagnostic-server.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = process.env.DIAGNOSTIC_OUTPUT || '/tmp/modal-diagnostic-smoke';
await mkdir(output, { recursive: true });
const server = await startDiagnosticServer({ enabled: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const results = [];
try {
    for (const selected of ['baseline', 'nobgglass', 'nobackdrop', 'nomodalblur', 'noai2poll', 'noprovider5poll', 'noactivity60poll', 'nofeedpoll']) {
        const context = await browser.newContext({ viewport: { width: 1100, height: 1000 } });
        await context.addInitScript(() => localStorage.setItem('theme', 'glass-light'));
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${server.url}/?flicker=${selected}`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.Alpine && Alpine.$data(document.body).articles?.length && window.__flickerDiagnostic);
        if (selected === 'nomodalblur') assert.equal(await page.evaluate(() => __flickerDiagnostic.verifyFilters().status), 'not-visible');
        await page.locator('aside li').filter({ hasText: 'AI Usage & Keys' }).click();
        await page.waitForFunction(() => Alpine.$data(document.body).onlineAiUsage?.events?.length && Alpine.$data(document.body).geminiDebugStats?.gemini);
        if (['nobgglass', 'nobackdrop', 'nomodalblur'].includes(selected))
            await page.waitForFunction(() => __flickerDiagnostic.verifyFilters().passed === true);
        const result = await page.evaluate(() => ({ selected: __flickerDiagnostic.selected,
            filterVerification: __flickerDiagnostic.verifyFilters(),
            modalFilter: getComputedStyle(document.querySelector('.ai-status-overlay')).backdropFilter,
            records: __flickerDiagnostic.export().records }));
        assert.equal(result.selected, selected);
        for (const path of ['/api/smart-status', '/api/summary/debug', '/api/online-ai-usage'])
            assert.ok(result.records.some(r => r.type === 'request-headers' && r.path === path && r.status === 200), `${selected}: initial ${path}`);
        const blocked = result.records.filter(r => r.type === 'poll-suppressed');
        assert.equal(blocked.length, ['noai2poll', 'noprovider5poll', 'noactivity60poll'].includes(selected) ? 1 : 0);
        if (blocked.length) assert.equal(blocked[0].kind, selected);
        if (selected === 'nobgglass') assert.match(result.modalFilter, /blur\(16px\)/, 'background ablation must retain modal glass');
        if (selected === 'nofeedpoll') {
            const dataRequests = () => server.requests.filter(r => r.startsWith('/api/data?')).length;
            const before = dataRequests();
            await page.evaluate(() => Alpine.$data(document.body).fetchData(false, true, true));
            assert.equal(dataRequests(), before);
            await page.evaluate(() => Alpine.$data(document.body).fetchData());
            assert.ok(dataRequests() > before, 'manual/initial data path must remain usable');
        }
        await page.locator('.ai-key-input').fill('diagnostic-unsaved-draft');
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !Alpine.$data(document.body).geminiStatusOpen);
        assert.equal(await page.evaluate(() => Alpine.$data(document.body).newGeminiKey), 'diagnostic-unsaved-draft');
        assert.deepEqual(errors, []);
        results.push({ ...result, errors, passed: true });
        console.log(JSON.stringify({ selected, passed: true, filterStatus: result.filterVerification.status }));
        await context.close();
    }
    // Live proxy validation uses a disposable dummy backend, never production.
    let requests = 0;
    const upstream = http.createServer(async (req, res) => {
        requests++; let body = ''; for await (const chunk of req) body += chunk;
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ method: req.method, body, url: req.url }));
    });
    await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
    const proxy = await startDiagnosticServer({ enabled: true, upstream: `http://127.0.0.1:${upstream.address().port}` });
    try {
        let response = await fetch(proxy.url + '/api/probe?test=1');
        assert.deepEqual(await response.json(), { method: 'GET', body: '', url: '/api/probe?test=1' });
        response = await fetch(proxy.url + '/api/probe', { method: 'POST', headers: { Origin: 'https://evil.example' }, body: 'blocked' });
        assert.equal(response.status, 403); assert.equal(requests, 1);
        response = await fetch(proxy.url + '/api/probe', { method: 'POST', headers: { Origin: proxy.url }, body: 'fixture-write' });
        assert.deepEqual(await response.json(), { method: 'POST', body: 'fixture-write', url: '/api/probe' });
        assert.equal(requests, 2);
        results.push({ selected: 'dummy-live-proxy-origin-guard', passed: true });
    } finally { proxy.close(); await new Promise(resolve => upstream.close(resolve)); }
} finally {
    await writeFile(`${output}/report.json`, JSON.stringify(results, null, 2));
    await browser.close(); server.close();
}
