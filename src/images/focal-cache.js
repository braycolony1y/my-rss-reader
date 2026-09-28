import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectImageFocus } from './focal-detector.js';

export const CENTER_FOCUS = Object.freeze({ x: 0.5, y: 0.5, type: 'center', confidence: 0 });
const VERSION = 5;
const MAX_BYTES = 8 * 1024 * 1024;

export function publicImageUrl(value) {
    try {
        const url = new URL(value);
        const host = url.hostname.toLowerCase();
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port && !['80', '443'].includes(url.port)) return null;
        // Downloads go through the existing external image proxy. Reject local
        // names and IP literals too, rather than passing them to that proxy.
        if (!host.includes('.') || host.includes(':') || /^\d+\.\d+\.\d+\.\d+$/.test(host) || /\.(local|localhost|internal|test|invalid)$/.test(host)) return null;
        url.hash = '';
        return url.href;
    } catch { return null; }
}

export async function readImageBytes(response) {
    if (!response.ok || !/^image\/(jpeg|png|webp|avif|gif|tiff|bmp)(?:;|$)/i.test(response.headers.get('content-type') || '') || Number(response.headers.get('content-length')) > MAX_BYTES) {
        await response.body?.cancel();
        throw new Error('Unsupported image response');
    }
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_BYTES) throw new Error('Image exceeds size limit');
            chunks.push(Buffer.from(value));
        }
    } finally { await reader.cancel().catch(() => {}); }
    return Buffer.concat(chunks);
}

export function createFocalCache({
    directory = fileURLToPath(new URL('../../article_cache/image-focus/', import.meta.url)),
    download,
    detect = detectImageFocus,
    maxPending = 40,
} = {}) {
    const memory = new Map();
    const pending = new Map();
    let tail = Promise.resolve();

    function remember(key, value, retryAt = Infinity) {
        memory.delete(key);
        memory.set(key, { value, retryAt });
        if (memory.size > 1000) memory.delete(memory.keys().next().value);
        return value;
    }

    async function get(rawUrl) {
        const url = publicImageUrl(rawUrl);
        if (!url) return CENTER_FOCUS;
        const key = createHash('sha256').update(`${VERSION}:${url}`).digest('hex');
        const cached = memory.get(key);
        if (cached?.retryAt > Date.now()) return cached.value;
        if (pending.has(key)) return pending.get(key);
        if (pending.size >= maxPending) return { ...CENTER_FOCUS, retry: true };
        // Serialise decode/inference, including concurrent requests from several
        // tabs. The browser already displays the image while this work runs.
        const job = tail.then(async () => {
            const filename = path.join(directory, `${key}.json`);
            try {
                const saved = JSON.parse(await readFile(filename, 'utf8'));
                if (saved.version === VERSION && Number.isFinite(saved.x) && Number.isFinite(saved.y)) return remember(key, saved);
            } catch { /* New image or incomplete cache entry. */ }
            try {
                const buffer = await download(url);
                const result = { ...await detect(buffer), version: VERSION };
                await mkdir(directory, { recursive: true });
                const temporary = `${filename}.${process.pid}.tmp`;
                await writeFile(temporary, JSON.stringify(result));
                await rename(temporary, filename);
                return remember(key, result);
            } catch {
                // Never persist a network/decoder failure as a successful centre
                // detection: allow a later visit to try again.
                return remember(key, { ...CENTER_FOCUS, retry: true }, Date.now() + 60_000);
            }
        }).finally(() => pending.delete(key));
        pending.set(key, job);
        tail = job.catch(() => {});
        return job;
    }
    return { get };
}
