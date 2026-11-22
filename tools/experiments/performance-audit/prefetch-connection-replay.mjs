import http from 'node:http';
import {readFile, writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const source = await readFile(new URL('../../../public/js/article/prefetch-lifecycle.js', import.meta.url), 'utf8');
let received = 0;
const timers = new Set();
const server = http.createServer((req, res) => {
    if (!req.url.startsWith('/slow')) {res.end(req.url === '/' ? '<!doctype html><title>Connection replay</title>' : '{}'); return;}
    received++;
    res.writeHead(200, {'Content-Type': 'application/json'}); res.flushHeaders();
    const timer = setTimeout(() => {timers.delete(timer); res.end('{"content":"cached"}');}, 1200);
    timers.add(timer); res.on('close', () => {clearTimeout(timer); timers.delete(timer);});
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({headless: true, args: ['--no-sandbox']});
const rows = [];
try {
    for (const variant of ['before', 'after', 'after', 'before']) {
        for (let run = 0; run < 4; run++) {
            const context = await browser.newContext(), page = await context.newPage();
            await page.goto(origin); await page.addScriptTag({content: source});
            received = 0;
            await page.evaluate(() => {
                window.app = {};
                window.background = Array.from({length: 3}, (_, i) => ReaderPrefetchLifecycle.read(app, '/slow?prefetch=' + i).catch(() => null));
                window.other = Array.from({length: 3}, (_, i) => fetch('/slow?other=' + i).then(r => r.json()));
            });
            const deadline = Date.now() + 3000;
            while (received < 6 && Date.now() < deadline) await new Promise(r => setTimeout(r, 5));
            if (received !== 6) throw Error('Failed to establish the matched six-connection workload');
            const sample = await page.evaluate(async variant => {
                const start = performance.now();
                if (variant === 'after') ReaderPrefetchLifecycle.cancel(app);
                const created = performance.now();
                const response = await fetch('/navigation'); await response.json();
                const complete = performance.now();
                const timing = performance.getEntriesByType('resource').find(r => r.name.endsWith('/navigation'));
                return {variant, totalMs: complete - start, browserWaitMs: timing.requestStart - timing.fetchStart,
                    actionToRequestMs: created - start, transferMs: timing.responseEnd - timing.responseStart};
            }, variant);
            rows.push(sample); console.log(JSON.stringify(sample));
            await context.close();
        }
    }
    await writeFile(process.argv[2], JSON.stringify(rows, null, 2));
} finally {
    await browser.close(); for (const timer of timers) clearTimeout(timer);
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
