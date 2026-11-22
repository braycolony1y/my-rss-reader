import { load } from 'cheerio';

function pixelWidth(style) {
    const match = String(style || '').match(/(?:^|;)\s*width\s*:\s*(\d+(?:\.\d+)?)px(?:\s*!important)?\s*(?:;|$)/i);
    const width = Math.round(Number(match?.[1]));
    return Number.isFinite(width) && width >= 1 && width <= 4096 ? width : null;
}

// XenForo puts user-selected image sizes on the wrapper, not necessarily the
// image. Transfer only that bounded pixel width before responsive cleanup
// removes wrapper styles and the media sanitizer removes image styles.
export function preserveVozWrapperImageWidths(markup) {
    if (typeof markup !== 'string' || !/bbImageWrapper/i.test(markup) || !/\bstyle\s*=/i.test(markup)) return markup;
    const $ = load(markup, null, false);
    let changed = false;
    $('.bbImageWrapper').each((_, element) => {
        const wrapper = $(element);
        const width = pixelWidth(wrapper.attr('style'));
        if (!width) return;
        wrapper.find('img').each((_, imageElement) => {
            const image = $(imageElement);
            // An explicit image width can be smaller than its container.
            const ownWidth = pixelWidth(image.attr('style'));
            image.attr('width', String(ownWidth ? Math.min(width, ownWidth) : width));
            if (ownWidth && ownWidth > width) {
                image.attr('style', image.attr('style').replace(/(^|;)\s*width\s*:[^;]*/i, `$1width: ${width}px`));
            }
            changed = true;
        });
    });
    return changed ? $.html() : markup;
}

// Archives retain the original post alongside its older rendered copy. Recover
// sizing by image identity without replacing the rendered quotes or embeds.
export function restoreVozImageDisplayWidths(markup, original) {
    if (!original || !/\bstyle\s*=/i.test(original) || !/<img\b/i.test(markup)) return markup;
    const source = load(original, null, false);
    const hints = new Map();
    const imageKey = image => {
        try { return new URL(image.attr('data-src') || image.attr('src'), 'https://voz.vn/').href; }
        catch { return ''; }
    };
    let hasWidth = false;
    source('img').each((_, element) => {
        const image = source(element);
        const wrapperWidth = pixelWidth(image.closest('.bbImageWrapper').attr('style'));
        const ownWidth = pixelWidth(image.attr('style'));
        const width = wrapperWidth && ownWidth ? Math.min(wrapperWidth, ownWidth) : wrapperWidth || ownWidth;
        const key = imageKey(image);
        if (!hints.has(key)) hints.set(key, []);
        hints.get(key).push(width);
        hasWidth ||= Boolean(width);
    });
    if (!hasWidth) return markup;
    const $ = load(markup, null, false);
    let changed = false;
    $('img').each((_, element) => {
        const image = $(element);
        const width = hints.get(imageKey(image))?.shift();
        if (!width || image.attr('width') === String(width)) return;
        image.attr('width', String(width));
        changed = true;
    });
    return changed ? $.html() : markup;
}
