import sourceRegistry from '../sources/index.js';
import { decodeHTMLEntities } from '../../feed-parsers.js';

function normalizeCachedArticleForSource(url, result) {
    if (!result?.content) return result;
    try {
        const sourceHandler = sourceRegistry.getHandler(url);
        if (!sourceHandler?.cleanCachedArticleContent) return result;
        const content = sourceHandler.cleanCachedArticleContent(result.content, result);
        return content === result.content ? result : { ...result, content };
    } catch (error) {
        console.warn(`[ARTICLE CACHE] Source-specific cleanup failed for ${url}: ${error.message}`);
        return result;
    }
}

function enhanceArticleResultForSource(url, result, context = {}) {
    if (!result || typeof result !== 'object') return result;
    try {
        const sourceHandler = sourceRegistry.getHandler(url);
        return sourceHandler?.enhanceArticleResult
            ? sourceHandler.enhanceArticleResult(result, { url, ...context })
            : result;
    } catch (error) {
        console.warn(`[ARTICLE] Source-specific result enhancement failed for ${url}: ${error.message}`);
        return result;
    }
}

function assertArticleResultAcceptedBySource(url, result) {
    const title = decodeHTMLEntities(String(result?.title || '')).replace(/\s+/g, ' ').trim();
    const text = decodeHTMLEntities(String(result?.content || ''))
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 3500);
    if (
        /(?:are you a robot|attention required|access (?:to this page )?(?:has been )?denied|just a moment|verifying the device)/i.test(title) ||
        /(?:we(?:'|’)ve detected unusual activity from your computer network|please click the box below to let us know you(?:'|’)re not a robot|press\s*(?:&|and)\s*hold\s+to confirm you are a human|before we continue.{0,160}(?:human|bot)|verifying the device|requested content will be available after verification|captcha-delivery\.com\/interstitial|reference id\s+[a-f0-9-]{12,}|enable javascript and cookies to continue|why did this happen\??\s*please make sure your browser supports javascript and cookies|block reference id\s*:)/i.test(text)
    ) {
        throw new Error('The reader returned a publisher challenge page instead of the article body');
    }
    const sourceHandler = sourceRegistry.getHandler(url);
    if (sourceHandler?.isUsableArticleResult?.(result, { url }) === false) {
        throw new Error('The reader returned only a related-story fragment instead of the article body');
    }
    return result;
}

export { normalizeCachedArticleForSource, enhanceArticleResultForSource, assertArticleResultAcceptedBySource };
