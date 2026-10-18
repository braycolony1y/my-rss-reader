import { normalizeArticleTitle } from '../../feed-parsers.js';
import { normalizeArticleSourceUrl } from '../article-source-state.js';
import { isGoogleNewsArticleUrl, isGoogleNewsHostedThumbnail } from './search-destination.js';
import { publisherIcon, safeHttpUrl, isInvalidImage, normalizeStateUrl, mapWithConcurrency } from '../utils/article-utils.js';
import { enhanceArticleResultForSource } from './source-results.js';
import sourceRegistry from '../sources/index.js';
import { absoluteTimestamp } from './source-time.js';
import { isVozThreadUrl } from '../voz-thread-state.js';

export function createClientArticlePreparer({ resolveGoogleNewsUrl, getLastKnownCachedArticle,
    getLastKnownCachedArticleImage, getCachedThreadCreationTime = async () => null }) {
    async function prepareArticleForClient(article, isSubItem = false) {
        const prepared = { ...article, title: normalizeArticleTitle(article.title) };
        prepared.link = normalizeArticleSourceUrl(prepared.link);
        if (prepared.originalLink) prepared.originalLink = normalizeArticleSourceUrl(prepared.originalLink);
        const cameFromGoogleNews = isGoogleNewsArticleUrl(prepared.link)
            || isGoogleNewsArticleUrl(prepared.originalLink);
        if (isGoogleNewsArticleUrl(prepared.link)) {
            prepared.originalLink = prepared.link;
            prepared.link = await resolveGoogleNewsUrl(prepared.link, prepared, { backgroundResolve: true, isSubItem });
            if (!isGoogleNewsArticleUrl(prepared.link)) prepared.feedIcon = publisherIcon(prepared.link);
        }
        if (safeHttpUrl(prepared.link) && (!prepared.feedIcon || /icons\.duckduckgo\.com\/ip3\//i.test(prepared.feedIcon))) {
            prepared.feedIcon = publisherIcon(prepared.link);
        }

        // Techmeme's RSS entry points to the Techmeme discussion page, while the
        // cached expanded article knows the original publisher. Surface that
        // metadata on list cards without re-fetching anything during tab open.
        try {
            const hostname = new URL(prepared.link).hostname.replace(/^www\./, '');
            if (hostname === 'techmeme.com' && !prepared.primarySource) {
                let cached = await getLastKnownCachedArticle(prepared.link);
                if (!cached && new URL(prepared.link).hash) {
                    const unfragmented = new URL(prepared.link);
                    unfragmented.hash = '';
                    cached = await getLastKnownCachedArticle(unfragmented.href);
                }
                if (cached) cached = enhanceArticleResultForSource(prepared.link, cached, { cacheMigration: true });
                if (cached?.primarySource) {
                    prepared.primarySource = cached.primarySource;
                    prepared.primaryArticleUrl = cached.primaryArticleUrl || cached.primarySource.url || '';
                    prepared.primaryArticleFetched = cached.primaryArticleFetched === true;
                    if (safeHttpUrl(cached.image) && !isInvalidImage(cached.image)) {
                        prepared.image = cached.image;
                    } else if (safeHttpUrl(prepared.primaryArticleUrl)) {
                        prepared.image = `/api/og-image?url=${encodeURIComponent(prepared.primaryArticleUrl)}`;
                    }
                }
            }
        } catch (error) { }

        // Google News entries often omit the publisher image. Reuse the real
        // image already stored with the prefetched publisher article instead of
        // making the browser show a generated placeholder and fetching again.
        try {
            const sourceHandler = sourceRegistry.getHandler(prepared.link);
            const readerImage = /^\/api\/og-image\?/.test(prepared.image || '');
            const currentImage = readerImage ? prepared.image : safeHttpUrl(prepared.image);
            const needsCachedImage = !currentImage
                || isInvalidImage(currentImage)
                || (cameFromGoogleNews && isGoogleNewsHostedThumbnail(currentImage))
                || sourceHandler?.isInvalidFeedImage?.(currentImage) === true;
            if (needsCachedImage && /^https?:\/\/(?:www\.)?(?:voz\.vn|tinhte\.vn)\//i.test(prepared.link)) {
                prepared.image = `/api/og-image?url=${encodeURIComponent(prepared.link)}`;
            } else if (needsCachedImage && safeHttpUrl(prepared.link) && !isGoogleNewsArticleUrl(prepared.link)) {
                const cachedImage = safeHttpUrl(await getLastKnownCachedArticleImage(prepared.link));
                if (cachedImage
                    && !isInvalidImage(cachedImage)
                    && sourceHandler?.isInvalidFeedImage?.(cachedImage) !== true) {
                    prepared.image = cachedImage;
                } else {
                    prepared.image = `/api/og-image?url=${encodeURIComponent(prepared.link)}`;
                }
            }
        } catch (error) { }

        if (isVozThreadUrl(prepared.link) && !absoluteTimestamp(prepared.source_created_at) && !absoluteTimestamp(prepared.createDate)) {
            prepared.createDate = await getCachedThreadCreationTime(prepared.link);
        }

        if (!prepared.originalLink) prepared.originalLink = prepared.link;
        prepared.link = normalizeStateUrl(prepared.link);

        if (Array.isArray(prepared.relatedArticles)) {
            prepared.relatedArticles = await mapWithConcurrency(prepared.relatedArticles, 4, a => prepareArticleForClient(a, true));
        }
        return prepared;
    }

    return prepareArticleForClient;
}
