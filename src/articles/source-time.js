import { load } from 'cheerio';
export function absoluteTimestamp(value) {
    if (value === null || value === undefined || value === '') return null;
    const raw = String(value).replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
    // Relative prose and dates without a timezone are never authoritative.
    if (!/^\d{10,13}$/.test(raw) && !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(raw)) return null;
    const date = new Date(/^\d+$/.test(raw) ? Number(raw) * (raw.length <= 10 ? 1000 : 1) : raw);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
export function sourceTimeMarkup({ source_created_at, created_at, cached_at, first_cached_at, first_seen_at, unavailable = false } = {}) {
    const created = absoluteTimestamp(source_created_at) || absoluteTimestamp(created_at);
    const captured = absoluteTimestamp(first_cached_at) || absoluteTimestamp(first_seen_at) || absoluteTimestamp(cached_at);
    const value = created || captured;
    if (!value) return '<span class="voz-post-time">Creation time unavailable</span>';
    const kind = created ? 'created' : 'cached';
    return `<time class="voz-post-time" datetime="${value}" data-source-time="${value}" data-time-kind="${kind}" data-time-exact="false" title="${value}" tabindex="0" role="button">${value}</time>`;
}
export function normalizeStoredPostTimes(content, { cached_at, unavailable = false } = {}) {
    if (!String(content).includes('voz-post')) return content;
    const $ = load(content, null, false);
    $('.voz-post').each((_, el) => {
        const node = $(el), time = node.find('.voz-post-time').first();
        const created = node.attr('data-source-created-at') || (time.attr('data-time-kind') === 'cached' ? null : time.attr('datetime'));
        const markup = sourceTimeMarkup({source_created_at:created,cached_at:time.attr('data-time-kind') === 'cached' ? time.attr('datetime') : cached_at,unavailable});
        if (time.length) time.replaceWith(markup);
        else node.find('.voz-post-info').first().prepend(markup);
    });
    return $.html();
}
