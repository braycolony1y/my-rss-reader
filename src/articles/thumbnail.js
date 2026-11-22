import sourceRegistry from '../sources/index.js';
import { extractImageFromHtml, isInvalidImage, safeHttpUrl } from '../utils/article-utils.js';
import { isVozThreadUrl } from '../voz-thread-state.js';
import { getVozThumbnail } from './voz-thumbnail.js';

export function getArticleThumbnail(url, result) {
    if (!result) return null;
    const source = sourceRegistry.getHandler(url);
    const valid = value => {
        if (!value || isInvalidImage(value) || source?.isInvalidFeedImage?.(value)) return null;
        try { return safeHttpUrl(new URL(value, url).href) || null; } catch { return null; }
    };
    if (isVozThreadUrl(url)) {
        return getVozThumbnail(url, result, valid);
    }
    return valid(result.image) || valid(extractImageFromHtml(result.content || '', url));
}
