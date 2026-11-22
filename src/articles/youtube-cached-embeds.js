import { load } from 'cheerio';
import { postIframePolicy } from './post-iframe-policy.js';

export function normalizeCachedYoutubeEmbeds(content) {
    if (!/<iframe\b/i.test(content || '') || !/youtube(?:-nocookie)?\.com/i.test(content)) return content;
    const $ = load(content, null, false);
    let changed = false;
    $('iframe').each((_, element) => {
        const frame = $(element);
        const policy = postIframePolicy(frame.attr('src'));
        if (!policy?.isYoutube) return;
        if (frame.attr('sandbox') === policy.sandbox && frame.attr('srcdoc') === undefined) return;
        frame.removeAttr('srcdoc').attr('sandbox', policy.sandbox);
        changed = true;
    });
    return changed ? $.html() : content;
}
