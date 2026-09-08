import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { load } from 'cheerio';
import { canonicalIdentity, canonicalUrl } from '../board/thread-model.js';
import { isVozThreadUrl, getVozPaginationMaxPage } from '../voz-thread-state.js';
import { renderPdfChunk, mergePdfChunks } from './pdf-renderer.js';

export function createPdfService({ fetchPage, retention, directory = './article_cache/pdf', render = renderPdfChunk, merge = mergePdfChunks,
    now = () => Date.now(), chunkSize = 5, pause = () => new Promise(resolve => setTimeout(resolve, 100)) }) {
    directory = path.resolve(directory);
    const jobs = new Map(), queue = [];
    let running = false, initialization;
    const folder = id => path.join(directory, id);
    const writes = new Map();
    const persist = job => {
        const write = (writes.get(job.id) || Promise.resolve()).catch(() => {}).then(async () => {
            await fs.mkdir(folder(job.id), { recursive: true });
            const file = path.join(folder(job.id), 'job.json'), temp = file + '.' + randomUUID() + '.tmp';
            await fs.writeFile(temp, JSON.stringify(job));
            await fs.rename(temp, file);
        });
        writes.set(job.id, write);
        write.finally(() => { if (writes.get(job.id) === write) writes.delete(job.id); }).catch(() => {});
        return write;
    };
    const isPending = job => ['queued', 'fetching', 'rendering', 'merging'].includes(job.status);
    const view = job => job ? { id: job.id, status: job.status, title: job.title, current: job.completedPages,
        total: job.totalPages, message: job.message, error: job.error || null, createdAt: job.createdAt,
        completedAt: job.completedAt || null, expiresAt: job.expiresAt || null,
        downloadUrl: job.status === 'ready' ? `/api/article-pdf/${job.id}/download` : null } : null;
    async function initialize() {
        if (initialization) return initialization;
        initialization = (async () => {
            await fs.mkdir(directory, { recursive: true });
            for (const name of await fs.readdir(directory)) {
                if (!/^[a-f0-9]{64}$/.test(name)) continue;
                try {
                    const job = JSON.parse(await fs.readFile(path.join(folder(name), 'job.json'), 'utf8'));
                    if (job.id !== name) continue;
                    if (isPending(job)) job.status = 'queued';
                    if (job.status === 'ready') {
                        try { await fs.access(path.join(folder(name), 'complete.pdf')); }
                        catch { job.status = 'error'; job.completedPages = 0; job.chunks = []; job.seenPostIds = []; job.message = 'The PDF file is missing. Download again to recreate it.'; }
                    }
                    jobs.set(name, job);
                } catch { /* An interrupted atomic write cannot publish a PDF. */ }
            }
            await cleanup();
            for (const job of jobs.values()) if (isPending(job)) queue.push(job.id);
            void pump();
        })();
        return initialization;
    }
    async function cleanup() {
        for (const [id, job] of jobs) {
            const state = await retention(job.url, Date.parse(job.createdAt));
            job.expiresAt = state.protected ? null : new Date(state.expiresAt).toISOString();
            if (!state.protected && state.expiresAt <= now()) {
                job.status = 'expired';
                jobs.delete(id);
                await fs.rm(folder(id), { recursive: true, force: true });
            }
        }
    }
    async function start({ url, title = '', feedUrl = '', totalPages = 1 }) {
        await initialize();
        const identity = canonicalIdentity(url);
        const id = createHash('sha256').update(identity).digest('hex');
        if (jobs.has(id)) await status(id);
        let job = jobs.get(id);
        if (job && ['ready', 'queued', 'fetching', 'rendering', 'merging'].includes(job.status)) return view(job);
        if (!job) {
            const total = Number(totalPages);
            job = { id, url: canonicalUrl(url), title: String(title).slice(0, 1000), feedUrl: String(feedUrl).slice(0, 4000),
                createdAt: new Date(now()).toISOString(), totalPages: isVozThreadUrl(url) && Number.isSafeInteger(total) && total > 0 ? total : 1,
                completedPages: 0, chunks: [], seenPostIds: [] };
            jobs.set(id, job);
        }
        job.generation = (job.generation || 0) + 1;
        job.status = 'queued'; job.error = null; job.message = 'Queued for PDF generation on the server.';
        await persist(job);
        if (!queue.includes(id)) queue.push(id);
        void pump();
        return view(job);
    }
    async function step(job) {
        if (!isPending(job)) return;
        const generation = job.generation;
        const active = () => isPending(job) && job.generation === generation;
        const pages = [], seen = new Set(job.seenPostIds);
        const startPage = job.completedPages + 1;
        for (let page = startPage; page <= job.totalPages && pages.length < chunkSize; page++) {
            if (!active()) return;
            job.status = 'fetching'; job.message = `Preparing thread page ${page} of ${job.totalPages}…`;
            const url = page === 1 ? job.url : job.url.replace(/\/$/, '') + '/page-' + page;
            let data, error;
            for (let attempt = 0; attempt < 3; attempt++) {
                try { data = await fetchPage(url, job.feedUrl, { page, force: attempt > 0 }); error = null; break; }
                catch (e) { error = e; if (!active()) return; await pause(); }
            }
            if (error) throw new Error(`Page ${page}: ${error.message}. Retry to continue from the last completed batch.`);
            if (!active()) return;
            if (!data?.content) throw new Error(`Page ${page} is unavailable. A complete PDF cannot be created yet.`);
            job.title ||= data.title || 'Article';
            if (page === 1) { job.author = data.author || ''; job.sourceDate = data.date || data.pubDate || ''; }
            if (page === 1) job.totalPages = isVozThreadUrl(job.url) ? Math.max(job.totalPages, getVozPaginationMaxPage(data.pagination)) : 1;
            let content = data.content;
            if (isVozThreadUrl(job.url)) {
                if (data.pagination?.currentPage && Number(data.pagination.currentPage) !== page) throw new Error(`The source returned a different page instead of page ${page}.`);
                const $ = load(content, null, false), posts = $('.voz-post');
                if (!posts.length) throw new Error(`No posts were available on page ${page}.`);
                const unique = [];
                posts.each((_, el) => {
                    const post = $(el), id = post.attr('data-absolute-post-id') || post.attr('id') || `${page}:${unique.length}`;
                    if (seen.has(id)) return;
                    seen.add(id); unique.push($.html(el));
                });
                if (!unique.length) throw new Error(`Page ${page} repeated an earlier page. Retry after the thread settles.`);
                content = unique.join('\n');
            }
            if (page === 1 && !isVozThreadUrl(job.url) && data.image && !content.includes(data.image)) {
                const escape = value => String(value || '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
                content = `<figure><img src="${escape(data.image)}"><figcaption>${escape(data.imageCaption)}</figcaption></figure>` + content;
            }
            pages.push({ page, content });
            await pause();
        }
        if (!active()) return;
        if (pages.length) {
            job.status = 'rendering'; job.message = `Creating PDF pages ${startPage}–${pages.at(-1).page} of ${job.totalPages}…`;
            const name = `part-${String(startPage).padStart(8, '0')}.pdf`;
            const output = path.join(folder(job.id), name), temporary = output + '.tmp';
            await render({ title: job.title, author: job.author, sourceDate: job.sourceDate, url: job.url, pages, createdAt: job.createdAt, output: temporary });
            if (!active()) { await fs.rm(temporary, { force: true }); return; }
            await fs.rename(temporary, output);
            if (!active()) return;
            job.chunks.push(name); job.completedPages = pages.at(-1).page; job.seenPostIds = [...seen];
            job.status = 'queued'; await persist(job);
        }
        if (job.completedPages < job.totalPages) return;
        job.status = 'merging'; job.message = 'Saving the complete PDF on the server…';
        await persist(job);
        const output = path.join(folder(job.id), 'complete.pdf');
        await merge(job.chunks.map(name => path.join(folder(job.id), name)), output + '.tmp');
        if (!active()) { await fs.rm(output + '.tmp', { force: true }); return; }
        const header = await fs.open(output + '.tmp', 'r');
        try { const bytes = Buffer.alloc(5); await header.read(bytes, 0, 5, 0); if (bytes.toString() !== '%PDF-') throw new Error('PDF generation produced an invalid file.'); }
        finally { await header.close(); }
        if (!active()) return;
        await fs.rename(output + '.tmp', output);
        if (!active()) return;
        job.status = 'ready'; job.completedAt = new Date(now()).toISOString(); job.message = 'PDF saved on the server. Ready to download.';
        await persist(job);
        for (const chunk of job.chunks) await fs.rm(path.join(folder(job.id), chunk), { force: true });
        job.chunks = []; job.seenPostIds = []; await persist(job);
    }
    async function pump() {
        if (running) return;
        running = true;
        try {
            while (queue.length) {
                const job = jobs.get(queue.shift());
                if (!job || !isPending(job)) continue;
                const generation = job.generation;
                try { await step(job); }
                catch (error) {
                    if (isPending(job) && job.generation === generation) { job.status = 'error'; job.error = error.message; job.message = error.message; await persist(job); }
                }
                if (isPending(job) && !queue.includes(job.id)) queue.push(job.id);
                await pause();
            }
        } finally { running = false; }
    }
    async function status(id) {
        await initialize();
        const job = jobs.get(id);
        if (!job) return null;
        const state = await retention(job.url, Date.parse(job.createdAt));
        if (!state.protected && state.expiresAt <= now()) { job.status = 'expired'; jobs.delete(id); await fs.rm(folder(id), { recursive: true, force: true }); return null; }
        job.expiresAt = state.protected ? null : new Date(state.expiresAt).toISOString();
        return view(job);
    }
    async function download(id) {
        const state = await status(id);
        if (state?.status !== 'ready') return null;
        const file = path.join(folder(id), 'complete.pdf');
        await fs.access(file);
        return { file, name: (state.title || 'Article').replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 120) + '.pdf' };
    }
    async function cancel(id) {
        await initialize(); const job = jobs.get(id);
        if (job && isPending(job)) { job.status = 'cancelled'; job.message = 'PDF generation paused. Download again to resume.'; await persist(job); }
        return view(job);
    }
    const whenIdle = async () => { while (running) await new Promise(resolve => setTimeout(resolve, 10)); };
    return { initialize, start, status, download, cancel, cleanup, whenIdle };
}
