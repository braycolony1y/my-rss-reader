import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createPdfService } from '../src/exports/pdf-service.js';
import { pdfDocument } from '../src/exports/pdf-renderer.js';
const url = 'https://voz.vn/t/example.123456';
const data = page => ({ title: 'Thread', content: `<div class="voz-post" data-absolute-post-id="${page}">Post ${page}</div>`, pagination: { currentPage: page } });
async function fixture(t, options = {}) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rss-pdf-test-'));
    const renders = [], calls = [];
    const config = { directory, fetchPage: async (_url, _feed, { page }) => { calls.push(page); return data(page); },
        retention: async () => ({ protected: false, expiresAt: Date.now() + 86400000 }),
        render: async args => { renders.push(args.pages.map(p => p.page)); await fs.writeFile(args.output, '%PDF-1.4\nFixture'); },
        merge: async (files, output) => { await fs.writeFile(output, '%PDF-1.4\n' + files.length + ' parts'); },
        pause: () => new Promise(resolve => setTimeout(resolve, 0)), ...options };
    const service = createPdfService(config);
    t.after(async () => { await service.whenIdle(); await fs.rm(directory, { recursive: true, force: true }); });
    return { service, directory, config, calls, renders };
}

test('PDF generation includes pages beyond 250 and exposes only the finished file', async t => {
    const { service, calls, renders } = await fixture(t, { chunkSize: 100 });
    const job = await service.start({ url, totalPages: 251 });
    assert.equal(await service.download(job.id), null);
    await service.whenIdle();
    const ready = await service.status(job.id);
    assert.equal(ready.status, 'ready');
    assert.equal(ready.current, 251);
    assert.equal(calls.length, 251);
    assert.deepEqual(renders.map(batch => batch.length), [100, 100, 51]);
    assert.match(await fs.readFile((await service.download(job.id)).file, 'utf8'), /^%PDF-/);
    const again = await service.start({ url: url + '/page-99' });
    assert.equal(again.id, job.id);
    assert.equal(again.status, 'ready');
});

test('failed batches remain unavailable and resume from the saved checkpoint after restart', async t => {
    let failing = true;
    const { service, config, renders } = await fixture(t, { chunkSize: 2, fetchPage: async (_url, _feed, {page}) => {
        if (page === 3 && failing) throw new Error('Source offline');
        return data(page);
    } });
    const job = await service.start({ url, totalPages: 4 });
    await service.whenIdle();
    assert.equal((await service.status(job.id)).status, 'error');
    assert.equal((await service.status(job.id)).current, 2);
    assert.equal(await service.download(job.id), null);
    failing = false;
    const resumed = createPdfService(config);
    await resumed.start({ url }); await resumed.whenIdle();
    assert.equal((await resumed.status(job.id)).status, 'ready');
    assert.deepEqual(renders, [[1, 2], [3, 4]]);
});

test('PDF expiration follows thread retention and saved-thread protection', async t => {
    let protectedThread = true, time = Date.now();
    const { service } = await fixture(t, { now: () => time, retention: async () => ({ protected: protectedThread, expiresAt: time - 1 }) });
    const job = await service.start({ url }); await service.whenIdle();
    await service.cleanup();
    assert.ok(await service.download(job.id));
    protectedThread = false;
    await service.cleanup();
    assert.equal(await service.status(job.id), null);
    assert.equal(await service.download(job.id), null);
});

test('incorrect or missing thread pages never produce a partial download', async t => {
    const { service } = await fixture(t, { fetchPage: async () => data(2) });
    const job = await service.start({ url }); await service.whenIdle();
    assert.equal((await service.status(job.id)).status, 'error');
    assert.equal(await service.download(job.id), null);
});

test('server PDF preserves Vietnamese text and reactions while stripping executable content', () => {
    const html = pdfDocument({ title: 'Chứng khoán', url, createdAt: '2026-09-08', pages: [{ page: 1,
        content: '<div class="voz-post">Tiếng Việt<script>alert(1)</script><img src="https://example.com/a.png" onerror="evil()"><div class="voz-post-likes">20 reactions</div><iframe src="https://www.youtube.com/embed/abc"></iframe></div>' }] });
    assert.match(html, /Tiếng Việt/); assert.match(html, /20 reactions/);
    assert.doesNotMatch(html, /<script|onerror|<iframe/);
    assert.match(html, /Open embedded media/);
});

test('pausing during rendering cannot publish a file and can resume safely', async t => {
    let finish, entered;
    const rendering = new Promise(resolve => { entered = resolve; });
    const { service } = await fixture(t, { render: async args => {
        entered(); await new Promise(resolve => { finish = resolve; });
        await fs.writeFile(args.output, '%PDF-1.4\nFixture');
    } });
    const job = await service.start({ url }); await rendering;
    await service.cancel(job.id); finish(); await service.whenIdle();
    assert.equal((await service.status(job.id)).status, 'cancelled');
    assert.equal(await service.download(job.id), null);
});
