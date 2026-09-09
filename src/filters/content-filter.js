import { decodeHTMLEntities } from '../../feed-parsers.js';

function plainBlockedText(value) {
    return decodeHTMLEntities(String(value || '').replace(/<[^>]+>/g, ' '))
        .normalize('NFC')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeBlockedText(value) {
    return plainBlockedText(value).toLowerCase();
}

const BLOCKED_ARTICLE_FIELDS = [
    { key: 'title', label: 'Title' },
    { key: 'subtitle', label: 'Subtitle' },
    { key: 'subheadline', label: 'Subheadline' },
    { key: 'description', label: 'Description' },
    { key: 'excerpt', label: 'Excerpt' },
    { key: 'summary', label: 'Summary' },
    { key: 'contentSnippet', label: 'Excerpt' },
    { key: 'content', label: 'Article excerpt' }
];

function normalizeBlockedKeywordEntries(input) {
    const seen = new Set();
    return (Array.isArray(input) ? input : [])
        .map(value => {
            const keyword = String(value || '')
                .trim()
                .normalize('NFC')
                .toLocaleLowerCase('vi-VN');
            return { keyword, normalized: normalizeBlockedText(keyword) };
        })
        .filter(entry => {
            if (!entry.normalized || seen.has(entry.normalized)) return false;
            seen.add(entry.normalized);
            return true;
        });
}

function contentFilterFieldValues(article) {
    const seen = new Set();
    return BLOCKED_ARTICLE_FIELDS.map(field => {
        const text = plainBlockedText(article?.[field.key]);
        const signature = field.label + '\0' + text;
        if (!text || seen.has(signature)) return null;
        seen.add(signature);
        return { ...field, text, normalized: text.toLowerCase() };
    }).filter(Boolean);
}

function articleContentFilterMatches(article, keywordEntries, includeDetails = false) {
    if (!keywordEntries.length) return includeDetails ? [] : false;
    if (!includeDetails) {
        // List filtering needs only a boolean. Stop at the first match without
        // constructing detailed snippets or normalizing the remaining fields.
        return BLOCKED_ARTICLE_FIELDS.some(field => {
            const value = article?.[field.key];
            if (value === undefined || value === null || value === '') return false;
            const normalized = normalizeBlockedText(value);
            return keywordEntries.some(entry => normalized.includes(entry.normalized));
        });
    }

    const fields = contentFilterFieldValues(article);
    const matches = [];
    for (const field of fields) {
        for (const entry of keywordEntries) {
            const index = field.normalized.indexOf(entry.normalized);
            if (index < 0) continue;
            const start = Math.max(0, index - 90);
            const end = Math.min(field.text.length, index + entry.normalized.length + 130);
            matches.push({
                field: field.key,
                fieldLabel: field.label,
                keyword: entry.keyword,
                snippet: (start ? '…' : '') + field.text.slice(start, end) + (end < field.text.length ? '…' : '')
            });
        }
    }
    return matches;
}

function combineContentFilterMatchDetails(details) {
    const combined = new Map();
    for (const detail of details) {
        const key = normalizeBlockedText(detail.keyword);
        if (!key) continue;
        const current = combined.get(key) || { keyword: detail.keyword, fieldLabels: [], snippet: '' };
        const previouslyOnlyTitle = current.fieldLabels.length === 1 && current.fieldLabels[0] === 'Title';
        if (!current.fieldLabels.includes(detail.fieldLabel)) current.fieldLabels.push(detail.fieldLabel);
        // Prefer an excerpt over repeating the title, then keep the most
        // informative available excerpt for this keyword.
        const detailIsTitle = detail.fieldLabel === 'Title';
        if (!current.snippet || (previouslyOnlyTitle && !detailIsTitle) || (!detailIsTitle && detail.snippet.length > current.snippet.length)) {
            current.snippet = detail.snippet;
        }
        combined.set(key, current);
    }
    return [...combined.values()];
}

function contentFilterPreviewLinkKey(value) {
    try {
        const parsed = new URL(value);
        parsed.hash = '';
        return parsed.href.replace(/\/$/, '');
    } catch (e) {
        return '';
    }
}

export { normalizeBlockedKeywordEntries, articleContentFilterMatches, contentFilterPreviewLinkKey, normalizeBlockedText, combineContentFilterMatchDetails, plainBlockedText, BLOCKED_ARTICLE_FIELDS, contentFilterFieldValues };
