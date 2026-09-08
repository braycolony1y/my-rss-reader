import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { load } from 'cheerio';
import { sanitizePostMarkup, escapePostText } from '../articles/voz-post-renderer.js';
const exec = promisify(execFile);

export function pdfDocument({ title, author, sourceDate, url, pages, createdAt }) {
    const $ = load(sanitizePostMarkup(pages.map(p => `<section><h2>Page ${p.page}</h2>${p.content}</section>`).join('')), null, false);
    $('button,script,style,form').remove();
    $('iframe,video,audio').each((_, el) => {
        const src = $(el).attr('src') || $(el).find('source').attr('src');
        $(el).replaceWith(src ? `<p><a href="${escapePostText(src)}">Open embedded media</a></p>` : '');
    });
    $('img').each((_, el) => {
        const img = $(el);
        let src = img.attr('src') || img.attr('data-src');
        try {
            const parsed = new URL(src, url);
            if (parsed.pathname === '/api/proxy-image') src = parsed.searchParams.get('url');
            img.attr('src', new URL(src, url).href).removeAttr('loading').removeAttr('srcset');
        } catch { img.remove(); }
    });
    return `<!doctype html><html><head><meta charset="utf-8"><title>${escapePostText(title)}</title><style>
    @page { size: A4; margin: 15mm; }
    * { box-sizing: border-box; } body { font: 12px/1.55 Arial,sans-serif; color:#182230; background:white; }
    h1 { font-size:24px; } h2 { font-size:14px; color:#667085; } a { color:#16725a; overflow-wrap:anywhere; }
    img { max-width:100%; max-height:235mm; object-fit:contain; } pre,code { white-space:pre-wrap; overflow-wrap:anywhere; }
    .voz-post { margin:14px 0; padding:14px; border:1px solid #d0d5dd; border-radius:12px; }
    .voz-post-header,.voz-post-author-group,.voz-post-info,.voz-post-likes { display:flex; align-items:center; gap:8px; }
    .voz-post-header { justify-content:space-between; flex-wrap:wrap; margin-bottom:12px; break-after:avoid; }
    .voz-post-author-group img { width:30px; height:30px; border-radius:50%; } .voz-post-author { font-weight:bold; }
    .voz-post-info,.voz-post-rank { font-size:10px; color:#667085; } .voz-post-likes { font-size:10px; margin-top:10px; }
    .voz-post-likes img,.voz-like-icon { width:18px; height:18px; } blockquote { background:#f2f4f7; border-left:3px solid #98a2b3; padding:12px; margin:8px 0; }
    figure { margin:12px 0; } figcaption { color:#667085; font-size:10px; } table { border-collapse:collapse; max-width:100%; } td,th { border:1px solid #ddd; padding:5px; }
    section + section { break-before:page; } .source { font-size:10px; color:#667085; } details > * { display:block; }
    </style></head><body><h1>${escapePostText(title)}</h1><p>${escapePostText(author || '')}${sourceDate ? ' · ' + escapePostText(sourceDate) : ''}</p><p class="source">Snapshot ${escapePostText(createdAt)} · <a href="${escapePostText(url)}">${escapePostText(url)}</a></p>${$.html()}</body></html>`;
}

export async function renderPdfChunk({ title, author, sourceDate, url, pages, createdAt, output }) {
    const { default: puppeteer } = await import('puppeteer-core');
    const browser = await puppeteer.launch({ executablePath: process.env.PDF_CHROMIUM_PATH || '/snap/bin/chromium', headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--renderer-process-limit=1'] });
    try {
        const page = await browser.newPage();
        await page.setJavaScriptEnabled(false);
        await page.setRequestInterception(true);
        page.on('request', request => {
            try {
                const u = new URL(request.url());
                // Only remote images are needed; do not execute embeds or expose local files/services.
                const local = /^(localhost|.*\.localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[|0\.)/i.test(u.hostname);
                if (request.resourceType() === 'image' && /^https?:$/.test(u.protocol) && !local) return void request.continue();
            } catch {}
            void request.abort();
        });
        await page.setContent(pdfDocument({ title, author, sourceDate, url, pages, createdAt }), { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.evaluate(async () => {
            await Promise.race([
                Promise.all([...document.images].map(img => img.complete ? Promise.resolve() : new Promise(resolve => { img.onload = img.onerror = resolve; }))),
                new Promise(resolve => setTimeout(resolve, 15000))
            ]);
            await document.fonts.ready;
        });
        await page.pdf({ path: output, format: 'A4', printBackground: true, preferCSSPageSize: true, timeout: 120000 });
    } finally { await browser.close(); }
}

export async function mergePdfChunks(files, output) {
    if (files.length === 1) { await fs.copyFile(files[0], output); return; }
    // Argument files and qpdf keep large exports out of Node's heap and argv limits.
    const argsFile = path.join(path.dirname(output), 'merge.args');
    await fs.writeFile(argsFile, ['--empty', '--pages', ...files.flatMap(file => [file, '1-z']), '--', output].join('\n'));
    try { await exec('qpdf', ['@' + argsFile], { timeout: 30 * 60 * 1000, maxBuffer: 1024 * 1024 }); }
    finally { await fs.rm(argsFile, { force: true }); }
}
