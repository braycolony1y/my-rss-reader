import { extractThreadSnapshot, extractLegacyPosts } from '../board/thread-model.js';
import sourceRegistry from '../sources/index.js';
import { normalizeArticleSourceUrl, isDeletedArticlePayload, deletedSourceTitle, deletedSourceKind } from '../article-source-state.js';
import { assertArticleResultAcceptedBySource, enhanceArticleResultForSource } from './source-results.js';
import { normalizeArticleTitle } from '../../feed-parsers.js';
import { isUnsafeVozThreadPayload, isDeletedVozThreadPayload } from '../voz-thread-state.js';
import { isUsableArticlePage } from './markup.js';
import { normalizedHostname, isRedditUrl } from '../utils/article-utils.js';

export function createArticlePipeline({
    fetchViaJina,
    fetchViaOpenCli,
    fetchArticleHtmlByStrategy,
    parseArticleHtmlContent,
    getArticleFetchPolicy,
} = {}) {
    async function expandArticleResultForSource(url, result, context = {}) {
        if (!result || typeof result !== 'object') return result;
        try {
            const sourceHandler = sourceRegistry.getHandler(url);
            return sourceHandler?.expandArticleResult
                ? await sourceHandler.expandArticleResult(result, {
                    url,
                    fetchPrimaryArticle: fetchPrimaryArticleForAggregate,
                    ...context
                })
                : result;
        } catch (error) {
            console.warn(`[ARTICLE] Source-specific expansion failed for ${url}: ${error.message}`);
            return result;
        }
    }

    async function fetchParsedArticleByStrategy(strategy, url, policy, feedUrl = '', fallbackTitle = '') {
        if (isRedditUrl(url)) return null;
        url = normalizeArticleSourceUrl(url);
        const commonMetadata = {
            url,
            feedUrl: feedUrl || '',
            fetchStrategy: strategy,
            attemptedStrategies: [strategy],
            availableStrategies: policy.availableStrategies,
            methodPreferences: {}
        };

        if (strategy === 'jina') {
            const result = await fetchViaJina(url);
            const accepted = assertArticleResultAcceptedBySource(url, {
                ...commonMetadata,
                ...result,
                title: normalizeArticleTitle(result.title || fallbackTitle || '')
            });
            return expandArticleResultForSource(url, enhanceArticleResultForSource(url, accepted));
        }

        if (strategy === 'opencli') {
            const result = await fetchViaOpenCli(url);
            if (isUnsafeVozThreadPayload(url, result) && !isDeletedVozThreadPayload(url, result)) {
                throw new Error('OpenCLI returned a VOZ error page');
            }
            const accepted = assertArticleResultAcceptedBySource(url, {
                ...commonMetadata,
                ...result,
                title: normalizeArticleTitle(result.title || fallbackTitle || '')
            });
            return expandArticleResultForSource(url, enhanceArticleResultForSource(url, accepted));
        }

        const html = await fetchArticleHtmlByStrategy(strategy, url);
        if (isDeletedArticlePayload(url, html)) {
            return {
                ...commonMetadata,
                title: deletedSourceTitle(url),
                content: '',
                isDeletedSource: true,
                isDeletedThread: deletedSourceKind(url) === 'thread'
            };
        }
        if (!html || !isUsableArticlePage(html)) {
            throw new Error('Fetched page did not contain usable article HTML');
        }
        let result = await parseArticleHtmlContent(
            html,
            url,
            strategy,
            [strategy],
            policy.availableStrategies,
            {},
            null,
            policy.excludedStrategies
        );
        if (result) {
            result.threadSnapshot = extractThreadSnapshot(html, url);
            if (result.threadSnapshot) {
                const rendered = new Map(extractLegacyPosts(result.content, url).map(post => [post.post_id, post]));
                for (const post of result.threadSnapshot.posts) {
                    const presentation = rendered.get(post.post_id);
                    post.display_content = presentation?.current_content || post.current_content;
                    if (presentation) {
                        post.reaction_html = presentation.reaction_html;
                        post.author_avatar = presentation.author_avatar || post.author_avatar;
                        post.author_rank = presentation.author_rank || post.author_rank;
                    }
                }
            }
            result.feedUrl = feedUrl || result.feedUrl || '';
            result.title = normalizeArticleTitle(result.title || fallbackTitle || '');
            result = enhanceArticleResultForSource(url, result);
            result = await expandArticleResultForSource(url, result);
        }
        return result;
    }

    function hasOnlyOpenCliFetchMethod(methods) {
        if (!Array.isArray(methods)) return false;
        const normalized = [...new Set(methods.map(method => String(method || '').trim().toLowerCase()).filter(Boolean))];
        return normalized.length === 1 && normalized[0] === 'opencli-fetch';
    }

    async function fetchPrimaryArticleForAggregate(value) {
        const url = normalizeArticleSourceUrl(value);
        if (!url || normalizedHostname(url) === 'techmeme.com') return null;
        const policy = await getArticleFetchPolicy(url, '');
        const preferredOrder = sourceRegistry.getHandler(url)?.preferredAggregateStrategies
            || ['jina', 'opencli-fetch', 'opencli', 'direct', 'cloudflare', 'vietserver', 'allorigins'];
        const strategyOrder = preferredOrder.filter(strategy => policy.strategyOrder.includes(strategy));
        for (const strategy of strategyOrder) {
            try {
                const result = await fetchParsedArticleByStrategy(strategy, url, policy);
                if (!result?.content || isDeletedArticlePayload(url, result)) continue;
                const textLength = String(result.content).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length;
                if (textLength >= 400) return result;
            } catch (error) {
                // The aggregate remains usable with its Techmeme summary when a
                // publisher reader is unavailable or requires a subscription.
            }
        }
        return null;
    }

    return {
        hasOnlyOpenCliFetchMethod,
        fetchParsedArticleByStrategy,
        expandArticleResultForSource
    };
}
