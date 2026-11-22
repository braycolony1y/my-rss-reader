import {assertArticleResultAcceptedBySource} from './source-results.js';
import {isDeletedArticlePayload} from '../article-source-state.js';

// Parsing is part of a reader attempt: unusable content must allow the next
// configured method rather than ending acquisition at a successful HTTP reply.
export async function parseStrategyCandidate(parse, html, url, ...args) {
    const result = await parse(html, url, ...args);
    if (isDeletedArticlePayload(url, result)) return result;
    assertArticleResultAcceptedBySource(url, result);
    const content = result?.content || '';
    if (content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length < 200
        && !/<(?:video|audio|img)\b/i.test(content)) throw new Error('Reader returned too little article content');
    return result;
}
