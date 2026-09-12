import { createHash } from 'node:crypto';
import { decodeHTML } from 'entities';

export const storyText = value => decodeHTML(String(value || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
export const storyMembers = cluster => [cluster, ...(cluster.relatedArticles || [])];
export function publisherId(article) {
    try { return new URL(article.domain ? `https://${article.domain}` : article.link).hostname.replace(/^(www\.|m\.)/, ''); }
    catch { return String(article.feedTitle || article.feedUrl || '').toLowerCase(); }
}
const fingerprint = article => storyText(article.title || article.link).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export function storyRevision(cluster) {
    return createHash('sha256').update(JSON.stringify(storyMembers(cluster).map(a =>
        [a.link, a.title, storyText(a.content || a.description).slice(0, 6000)]).sort((a,b) => a[0].localeCompare(b[0])))).digest('hex').slice(0, 24);
}
export function rankStory(articles, tab = '', now = Date.now(), editorial = null) {
    if (!articles.length) return { score: 1, independentSources: 0 };
    const publishers = new Map();
    const headlines = new Map();
    for (const article of articles) {
        const id = publisherId(article);
        publishers.set(id, Math.max(publishers.get(id) || 0, Number(article.sourceWeight) || 1));
        const title = fingerprint(article);
        // Reprints of the same headline do not renew a story's freshness.
        const date = article.publicationTimeReliable === false ? 0 : Date.parse(article.pubDate) || 0;
        if (!headlines.has(title) || date < headlines.get(title)) headlines.set(title, date);
    }
    const text = articles.map(a => storyText(a.title)).join(' ').toLowerCase();
    const impactSignals = [
        /\b(invasion|ceasefire|sanctions|presidential election|parliamentary election|earthquake|evacuat\w*|killed|emergency)\b|chiến tranh|ngừng bắn|bầu cử|động đất|thiệt mạng/u,
        /\b(central bank|interest rate|inflation|tariff|recession|default|bankruptcy|rate cut|rate hike)\b|lãi suất|lạm phát|thuế quan|phá sản/u,
        /\b(antitrust|data breach|chip export|regulator|security flaw|acquisition|critical vulnerability)\b|rò rỉ dữ liệu|đột phá|độc quyền/u
    ];
    const importance = editorial?.importance ?? Math.min(1, 0.28 + impactSignals.filter(r => r.test(text)).length * 0.34);
    const material = editorial?.material ?? (/\b(announces?|approves?|signs?|launches?|raises?|cuts?|strikes?|confirms?)\b|thông qua|công bố|ban hành/u.test(text) ? 0.8 : 0.4);
    const repeat = editorial?.repeat ?? (/\b(recap|roundup|what we know|explained|opinion|preview)\b|điểm tin|nhìn lại/u.test(text) ? 0.45 : 0);
    const age = Math.max(0, (now - Math.max(...headlines.values())) / 3600000);
    const freshness = Math.exp(-age / 30);
    const relevance = articles.some(a => !tab || a.smartCategory === tab || (tab === 'news' && a.smartCategory?.startsWith('news_')) || (tab === 'finance' && a.smartCategory?.startsWith('finance_'))) ? 1 : 0.4;
    const authority = Math.min(1, Math.max(...publishers.values()) / 1.2);
    // Publisher identities are an estimate of independence. Identical headlines
    // cap corroboration, and total coverage contributes at most 8% of the score.
    const diversity = Math.min(1, Math.log2(1 + Math.min(publishers.size, headlines.size)) / 3);
    const lowConsequence = /\b(lucky|my default|best deals|coupon|discount|writers have|youtubers|review|unboxing|wallpaper|weekend menu)\b/u.test(text) ? 0.18 : 0;
    const score = 10 * (0.45 + 0.55 * freshness) * (0.36 * importance + 0.12 * relevance + 0.22 * freshness + 0.12 * material + 0.10 * authority + 0.08 * diversity - 0.12 * repeat - lowConsequence);
    return { score: Math.round(Math.max(1, Math.min(10, score)) * 10) / 10, independentSources: publishers.size,
        updatedAt: new Date(Math.max(...articles.map(a => Date.parse(a.pubDate) || 0))).toISOString(),
        signals: { importance, relevance, freshness, material, authority, diversity, repeat } };
}

// Only inherit an identity once when a previous cluster splits. When events
// merge, the largest overlapping identity wins; the revision still invalidates prose.
export function retainStoryIds(clusters, previous) {
    const byLink = new Map();
    for (const old of previous) if (old.clusterId) for (const member of storyMembers(old)) byLink.set(member.link, old.clusterId);
    const claimed = new Set();
    return clusters.map(cluster => {
        const counts = new Map();
        for (const member of storyMembers(cluster)) { const id = byLink.get(member.link); if (id) counts.set(id, (counts.get(id) || 0) + 1); }
        const match = [...counts].sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0])).find(([id]) => !claimed.has(id));
        const clusterId = match?.[0] || cluster.clusterId;
        claimed.add(clusterId);
        return { ...cluster, clusterId };
    });
}
