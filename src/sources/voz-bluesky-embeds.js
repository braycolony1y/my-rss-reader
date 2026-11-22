import { load } from 'cheerio';

// XenForo stores profile/post as one media key and encodes its slashes in
// the fallback href. Keep a canonical link while the client resolves the DID.
export function transformVozBlueskyEmbeds(markup) {
    const source = String(markup || '');
    if (!/data-media-site-id\s*=\s*["']bluesky["']/i.test(source)) return source;
    const $ = load(source, null, false);
    let changed = false;
    $('.bbOembed[data-media-site-id="bluesky"]').each((_, element) => {
        const block = $(element);
        let key = block.attr('data-media-key') || block.attr('data-id') || '';
        try { key = decodeURIComponent(key); } catch { return; }
        const match = key.match(/^((?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}|did:plc:[a-z2-7]{24})\/post\/([a-zA-Z0-9]{1,64})$/);
        if (!match) return;
        const url = `https://bsky.app/profile/${match[1]}/post/${match[2]}`;
        block.replaceWith(`<div class="voz-bluesky-embed" data-bluesky-url="${url}"><a class="voz-bluesky-embed__fallback" href="${url}" target="_blank" rel="noopener noreferrer external">Open this post on Bluesky</a></div>`);
        changed = true;
    });
    return changed ? $.html() : source;
}
