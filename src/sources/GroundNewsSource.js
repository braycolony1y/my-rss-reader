import { renderGroundNewsStory } from './ground-news-reader.js';
import * as cheerio from 'cheerio/slim';

export const GROUND_URL = 'https://ground.news/';
const text = value => typeof value === 'string' && !/^\$/.test(value) ? value.trim() : '';
const identifier = value => typeof value === 'number' ? String(value) : text(value);
function httpUrl(value, base = GROUND_URL) {
    if (!text(value)) return null;
    try {
        const url = new URL(value, base);
        return /^https?:$/.test(url.protocol) ? url.href : null;
    } catch { return null; }
}
function date(value) {
    if (!value || (typeof value !== 'string' && typeof value !== 'number')) return null;
    const parsed = new Date(typeof value === 'number' && value < 1e12 ? value * 1000 : value);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}
function canonicalStory(value, id) {
    const raw = text(value);
    const url = httpUrl(raw ? (/^[\w-]+$/.test(raw) ? `article/${raw}` : raw) : id ? `article/${encodeURIComponent(id)}` : '');
    if (!url) return null;
    const parsed = new URL(url);
    if (!['ground.news', 'www.ground.news'].includes(parsed.hostname) || !/^\/article\/[^/]+/.test(parsed.pathname)) return null;
    return `https://ground.news${parsed.pathname.replace(/\/$/, '')}`;
}

// Read JSON only; never execute scripts from the upstream page. Flight text
// chunks may split records, so concatenate before examining record boundaries.
export function extractGroundPayloads(html) {
    const $ = cheerio.load(html);
    const chunks = [];
    $('script').each((_, script) => {
        const body = $(script).html() || '';
        const pattern = /self\.__next_f\.push\(\s*(\[(?:[^"\]]|"(?:\\.|[^"\\])*")*\])\s*\)/g;
        for (const match of body.matchAll(pattern)) {
            try {
                const entry = JSON.parse(match[1]);
                if (entry[0] === 1 && typeof entry[1] === 'string') chunks.push(entry[1]);
            } catch { /* unrelated or malformed push */ }
        }
    });
    const records = new Map();
    const stream = Buffer.from(chunks.join(''));
    let offset = 0;
    while (offset < stream.length) {
        const colon = stream.indexOf(58, offset);
        if (colon < 0) break;
        const key = stream.subarray(offset, colon).toString();
        if (!/^[\da-f]+$/i.test(key)) { offset = stream.indexOf(10, offset) + 1; if (!offset) break; continue; }
        offset = colon + 1;
        // Flight length-prefixed UTF-8 text records (including embedded newlines).
        if (stream[offset] === 84) {
            const comma = stream.indexOf(44, offset);
            const lengthText = stream.subarray(offset + 1, comma).toString();
            if (comma >= offset && /^[\da-f]+$/i.test(lengthText)) {
                const end = comma + 1 + parseInt(lengthText, 16);
                records.set(key, stream.subarray(comma + 1, end).toString());
                offset = end;
                if (stream[offset] === 10) offset++;
                continue;
            }
        }
        let end = stream.indexOf(10, offset);
        if (end < 0) end = stream.length;
        try { records.set(key, JSON.parse(stream.subarray(offset, end).toString())); } catch { /* module/hint/error records */ }
        offset = end + 1;
    }
    const resolve = (value, ancestors = new Set(), depth = 0) => {
        if (depth > 100) return null;
        if (typeof value === 'string' && /^\$(?:L|@)?[\da-f]+$/i.test(value)) {
            const key = value.replace(/^\$(?:L|@)?/, '');
            if (!records.has(key) || ancestors.has(key)) return null;
            return resolve(records.get(key), new Set([...ancestors, key]), depth + 1);
        }
        if (Array.isArray(value)) return value.map(v => resolve(v, ancestors, depth + 1));
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v, ancestors, depth + 1)]));
        return value;
    };
    return [...records.values()].filter(v => v && typeof v === 'object').map(v => resolve(v));
}

export function parseGroundNews(html) {
    const byId = new Map(), byUrl = new Map();
    let candidates = 0;
    const walk = (value, sections = [], depth = 0) => {
        if (!value || typeof value !== 'object' || depth > 100) return;
        if (Array.isArray(value)) { for (const child of value) walk(child, sections, depth + 1); return; }
        const section = text(value.sectionName) || text(value.feedName) || text(value.section) || text(value.feed);
        const context = section ? [...new Set([...sections, section])] : sections;
        const id = identifier(value.eventId || value.storyId || value.id);
        const title = text(value.title || value.headline);
        const url = canonicalStory(value.slug || value.url || value.link, id);
        const isStory = title && url && (value.sourceCount !== undefined || Array.isArray(value.sources)
            || value.biasSourceCount !== undefined || value.blindspotData !== undefined
            || (value.start && value.description !== undefined));
        if (isStory) {
            candidates++;
            const description = text(value.description) || text(value.summary);
            const sources = (Array.isArray(value.sources) ? value.sources : []).filter(s => s && typeof s === 'object').map(s => ({
                ...s, name: text(s.sourceInfo?.name || s.name || s.publisher?.name),
                url: httpUrl(s.url || s.articleUrl), date: date(s.date || s.publishedAt),
                bias: s.sourceInfo?.bias ?? s.bias ?? null
            }));
            const publishedAt = date(value.start || value.publishedAt || value.publicationDate);
            const image = httpUrl(value.latestMedia?.url) || httpUrl(value.fallbackMedia?.url) || httpUrl(value.image?.url || value.image);
            const groundNews = {
                eventId: id || null, slug: text(value.slug) || null,
                sourceCount: Number.isFinite(Number(value.sourceCount)) && value.sourceCount != null ? Number(value.sourceCount) : null,
                sources, summaries: value.chatGptSummaries ?? {}, biasSourceCount: value.biasSourceCount ?? null,
                blindspotData: value.blindspotData ?? null, blindspot: value.blindspot ?? null,
                place: value.place ?? null, sections: context,
                interests: value.interests ?? [], latestMedia: value.latestMedia ?? null, fallbackMedia: value.fallbackMedia ?? null
            };
            const item = { id: id || url, guid: id || url, title, url, link: url, description, content: description,
                publishedAt, pubDate: publishedAt, image, imageUrl: image, groundNews };
            const old = (id && byId.get(id)) || byUrl.get(url);
            if (old) {
                for (const key of ['description', 'content', 'image', 'imageUrl', 'publishedAt', 'pubDate']) if (!old[key] && item[key]) old[key] = item[key];
                if (!old.groundNews.eventId && id) { old.id = old.guid = id; old.groundNews.eventId = id; }
                if (!old.groundNews.slug && groundNews.slug) { old.url = old.link = url; old.groundNews.slug = groundNews.slug; }
                const merged = new Map([...old.groundNews.sources, ...sources].map(s => [s.url || s.name, s]));
                old.groundNews.sources = [...merged.values()];
                old.groundNews.summaries = { ...old.groundNews.summaries, ...groundNews.summaries };
                old.groundNews.sections = [...new Set([...old.groundNews.sections, ...context])];
                for (const [key, val] of Object.entries(groundNews)) {
                    if (key === 'sources' || key === 'sections' || key === 'summaries') continue;
                    if (val != null && (old.groundNews[key] == null || (Array.isArray(old.groundNews[key]) && !old.groundNews[key].length))) old.groundNews[key] = val;
                }
                byUrl.set(url, old);
                if (id) byId.set(id, old);
            } else {
                byUrl.set(url, item);
                if (id) byId.set(id, item);
            }
            return; // Publisher articles belong to this cluster, never separate items.
        }
        for (const child of Object.values(value)) walk(child, context, depth + 1);
    };
    for (const payload of extractGroundPayloads(String(html || ''))) walk(payload);
    return { feedTitle: 'Ground News', items: [...new Set(byUrl.values())], diagnostics: { candidates } };
}

export default class GroundNewsSource {
    feedTitle = 'Ground News';
    parseArticleHtmlContent(html, url, result) {
        const canonical = canonicalStory(url);
        const item = parseGroundNews(html).items.find(item => item.url === canonical
            || canonical === canonicalStory('', item.id));
        if (!item) return false;
        result.title = item.title;
        result.date = item.publishedAt || result.date;
        result.image = item.image || result.image;
        result.groundNews = item.groundNews;
        return renderGroundNewsStory(item);
    }
    isUsableArticleResult(result) {
        // Invalidate only old Ground reader output, leaving other caches intact.
        return /data-ground-reader=["']2["']/.test(result?.content || '');
    }
    match(host) { return host === 'ground.news' || host === 'www.ground.news'; }
    publisherIcon() { return 'https://ground.news/favicon.ico'; }
    constructor({ fetchImpl = globalThis.fetch, now = Date.now, ttl = 10 * 60 * 1000 } = {}) {
        this.fetchImpl = fetchImpl; this.now = now; this.ttl = ttl;
        this.cached = null; this.pending = null; this.retryAt = 0;
    }
    async fetchFeed() {
        if (this.pending) return this.pending;
        if (this.now() < this.retryAt) {
            if (this.cached) return this.cached;
            throw new Error('Ground News refresh is cooling down after a failed request');
        }
        this.pending = (async () => {
            try {
                const response = await this.fetchImpl(GROUND_URL, {
                    signal: AbortSignal.timeout(20000),
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9'
                    }
                });
                if (!response.ok) { await response.body?.cancel(); throw new Error(`Ground News HTTP ${response.status}`); }
                const chunks = [];
                let bytes = 0;
                for await (const chunk of response.body) {
                    bytes += chunk.length;
                    if (bytes > 15 * 1024 * 1024) throw new Error('Ground News HTML exceeded parser size limit');
                    chunks.push(Buffer.from(chunk));
                }
                const html = Buffer.concat(chunks).toString('utf8');
                const result = parseGroundNews(html);
                if (!result.items.length) throw new Error(`Ground News parser found no stories (${html.length} characters)`);
                this.cached = result;
                this.retryAt = this.now() + this.ttl;
                return result;
            } catch (error) {
                this.retryAt = this.now() + 60000;
                // Existing persisted articles are retained by the shared sync pipeline.
                throw new Error(`Ground News refresh failed: ${String(error.message).slice(0, 200)}`);
            } finally { this.pending = null; }
        })();
        return this.pending;
    }
}
