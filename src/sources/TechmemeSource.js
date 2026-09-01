import * as cheerio from 'cheerio/slim';
import { decodeHTML } from 'entities';

function escapeHtml(value = '') {
    return String(value).replace(/[&<>"']/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[character]);
}

function safeHttpUrl(value = '') {
    try {
        const url = new URL(decodeHTML(String(value || '')));
        return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch (error) {
        return '';
    }
}

export function canonicalPrimaryArticleUrl(value = '') {
    const href = safeHttpUrl(value);
    if (!href) return '';
    try {
        const url = new URL(href);
        url.hash = '';
        for (const name of [...url.searchParams.keys()]) {
            if (/^(?:access_?token|token|auth|signature|sig|key)$/i.test(name)
                || /^(?:utm_|mc_)/i.test(name)
                || /^(?:fbclid|gclid|cmpid|srnd)$/i.test(name)) {
                url.searchParams.delete(name);
            }
        }
        return url.href;
    } catch (error) {
        return href;
    }
}

function sourceMetadata(name = '', value = '') {
    const url = canonicalPrimaryArticleUrl(value);
    if (!url) return null;
    const domain = new URL(url).hostname.replace(/^www\./, '');
    const normalizedName = cleanText(name).replace(/:$/, '') || domain;
    return {
        name: normalizedName,
        domain,
        url,
        icon: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`
    };
}

function storyIdFromUrl(value = '') {
    try {
        const url = new URL(value);
        const pathnameMatch = url.pathname.match(/\/(\d{6})\/p(\d+)/i);
        if (pathnameMatch) return `${pathnameMatch[1]}p${pathnameMatch[2]}`;
        return url.hash.match(/#?a?(\d{6}p\d+)/i)?.[1] || '';
    } catch (error) {
        return '';
    }
}

function cleanText(value = '') {
    return decodeHTML(String(value || ''))
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function linksFrom(node, $) {
    return node.find('a[href]').toArray().map(element => ({
        href: safeHttpUrl($(element).attr('href')),
        title: cleanText($(element).text())
    })).filter(link => link.href);
}

function markdownLinkFromText(text = '') {
    const match = String(text).match(/\[([\s\S]{3,1000})\]\((https?:\/\/[^)\s]+)\)/);
    return match ? { title: cleanText(match[1]), href: safeHttpUrl(match[2]) } : null;
}

function relatedThumbnailUrl(articleUrl = '') {
    const href = safeHttpUrl(articleUrl);
    return href ? `/api/og-image?url=${encodeURIComponent(href)}` : '';
}

function xHandleFromUrl(value = '') {
    try {
        const handle = new URL(value).pathname.split('/').filter(Boolean)[0] || '';
        return handle ? `@${handle.replace(/^@/, '')}` : '';
    } catch (error) {
        return '';
    }
}

function xUsername(handle = '') {
    return cleanText(handle).replace(/^@/, '').replace(/[^a-z0-9_]/gi, '').slice(0, 32);
}

function xProfileImageUrl(handle = '') {
    const username = xUsername(handle);
    return username ? `/api/x-profile-image?handle=${encodeURIComponent(username)}` : '';
}

function xProfileInitial(author = '', handle = '') {
    const label = cleanText(author || handle).replace(/^@/, '').trim();
    return (label.match(/[\p{L}\p{N}]/u)?.[0] || '•').toUpperCase();
}

function renderXProfile(author = '', handle = '') {
    const image = xProfileImageUrl(handle);
    return `<span class="techmeme-x-post__profile" aria-hidden="true">${escapeHtml(xProfileInitial(author, handle))}${image
        ? `<img class="techmeme-x-post__profile-image" src="${escapeHtml(image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
        : ''}</span>`;
}

function renderRelatedSection(items) {
    if (!items.length) return '';
    const cards = items.map(item => {
        const thumbnail = item.image || relatedThumbnailUrl(item.href);
        return `<div class="embedded-suggested-card techmeme-related-card">
        <a href="${escapeHtml(item.href)}" target="_blank" rel="noopener noreferrer" class="embedded-suggested-overlay" aria-label="${escapeHtml(item.title)}"></a>
        ${thumbnail ? `<img src="${escapeHtml(thumbnail)}" class="embedded-suggested-image techmeme-related-card__image" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ''}
        <div class="embedded-suggested-content">
            ${item.source ? `<div class="embedded-suggested-category">${escapeHtml(item.source)}</div>` : ''}
            <div class="embedded-suggested-title">${escapeHtml(item.title)}</div>
        </div>
    </div>`;
    }).join('');

    return `<section class="embedded-suggested-articles techmeme-related" aria-label="Related articles">
        <div class="embedded-suggested-header">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>
            Related articles
        </div>
        <div class="embedded-suggested-carousel">${cards}</div>
    </section>`;
}

function renderXPosts(items) {
    if (!items.length) return '';
    const posts = items.map(item => {
        const handle = item.handle || xHandleFromUrl(item.href);
        const author = cleanText(item.author || handle || 'Post on X');
        return `<li class="techmeme-x-post">
        <a href="${escapeHtml(item.href)}" target="_blank" rel="noopener noreferrer">
            ${renderXProfile(author, handle)}
            <span class="techmeme-x-post__body">
                <span class="techmeme-x-post__identity">
                    <span class="techmeme-x-post__author">${escapeHtml(author)}</span>
                    ${handle && handle !== author ? `<span class="techmeme-x-post__handle">${escapeHtml(handle)}</span>` : ''}
                </span>
                <span class="techmeme-x-post__text">${escapeHtml(item.text)}</span>
            </span>
        </a>
    </li>`;
    }).join('');
    return `<section class="techmeme-x-posts" aria-label="X posts">
        <h3 class="techmeme-section-title"><span aria-hidden="true">𝕏</span> Posts on X</h3>
        <ul>${posts}</ul>
    </section>`;
}

export function extractTechmemeStory(markup = '', pageUrl = '') {
    const storyId = storyIdFromUrl(pageUrl);
    if (!storyId || !String(markup).trim()) return null;

    const $ = cheerio.load(`<main id="techmeme-reader-root">${markup}</main>`, null, false);
    const root = $('#techmeme-reader-root');
    const existingStory = root.children('.techmeme-story').first();
    if (existingStory.length) {
        let changed = false;
        const obsoleteHeader = existingStory.find('.techmeme-primary-article__header');
        if (obsoleteHeader.length) {
            obsoleteHeader.remove();
            changed = true;
        }
        existingStory.find('.techmeme-primary-article').each((_, element) => {
            const section = $(element);
            const ariaLabel = cleanText(section.attr('aria-label'));
            if (/^Full article from\s+/i.test(ariaLabel)) {
                section.attr('aria-label', ariaLabel.replace(/^Full article from\s+/i, 'Article from '));
                changed = true;
            }
        });
        existingStory.find('.techmeme-related-card').each((_, element) => {
            const card = $(element);
            if (card.children('img').length) return;
            const href = safeHttpUrl(card.find('a[href]').first().attr('href'));
            const thumbnail = relatedThumbnailUrl(href);
            if (thumbnail) {
                card.find('.embedded-suggested-content').first().before(`<img src="${escapeHtml(thumbnail)}" class="embedded-suggested-image techmeme-related-card__image" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`);
                changed = true;
            }
        });
        existingStory.find('.techmeme-x-post').each((_, element) => {
            const post = $(element);
            const link = post.find('a[href]').first();
            const href = safeHttpUrl(link.attr('href'));
            const author = cleanText(post.find('.techmeme-x-post__author').first().text()) || xHandleFromUrl(href) || 'Post on X';
            const handle = xHandleFromUrl(href);
            const text = cleanText(post.find('.techmeme-x-post__text').first().text());
            const profile = post.find('.techmeme-x-post__profile').first();
            if (profile.length) {
                const image = xProfileImageUrl(handle);
                if (image && !profile.find('.techmeme-x-post__profile-image').length) {
                    profile.append(`<img class="techmeme-x-post__profile-image" src="${escapeHtml(image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`);
                    changed = true;
                }
                return;
            }
            link.html(`${renderXProfile(author, handle)}
                <span class="techmeme-x-post__body">
                    <span class="techmeme-x-post__identity">
                        <span class="techmeme-x-post__author">${escapeHtml(author)}</span>
                        ${handle && handle !== author ? `<span class="techmeme-x-post__handle">${escapeHtml(handle)}</span>` : ''}
                    </span>
                    <span class="techmeme-x-post__text">${escapeHtml(text)}</span>
                </span>`);
            changed = true;
        });
        const sourceText = cleanText(existingStory.find('.techmeme-main-story__source').first().text());
        return {
            html: changed ? root.html().trim() : String(markup).trim(),
            title: cleanText(existingStory.find('.techmeme-main-story h2 a').first().text()),
            author: cleanText(existingStory.attr('data-techmeme-author')),
            publisher: cleanText(existingStory.attr('data-techmeme-publisher')) || sourceText.split(/\s*\/\s*/).at(-1),
            mainUrl: canonicalPrimaryArticleUrl(existingStory.attr('data-techmeme-main-url'))
        };
    }

    const children = root.children().toArray();
    const markerIndex = children.findIndex(element => $(element).text().includes(`pml="${storyId}"`));
    if (markerIndex < 0) return null;
    let endIndex = children.findIndex((element, index) => index > markerIndex && /pml="\d{6}p\d+"/i.test($(element).text()));
    if (endIndex < 0) endIndex = children.length;

    const markerText = cleanText($(children[markerIndex]).text());
    const bylineText = cleanText(markerText.match(/<cite>([\s\S]*?)<\/cite>/i)?.[1] || markerText)
        .replace(/:$/, '');
    const bylineParts = bylineText.split(/\s*\/\s*/).filter(Boolean);
    const author = bylineParts.length > 1 ? bylineParts.slice(0, -1).join(' / ') : '';
    const publisher = bylineParts.at(-1) || 'Techmeme';

    const mainIndex = children.findIndex((element, index) => index > markerIndex
        && index < endIndex
        && $(element).find('strong a[href]').length > 0);
    if (mainIndex < 0) return null;
    const mainNode = $(children[mainIndex]);
    const headlineLink = mainNode.find('strong a[href]').first();
    const headline = cleanText(headlineLink.text());
    const mainUrl = canonicalPrimaryArticleUrl(headlineLink.attr('href'));
    if (!headline || !mainUrl) return null;

    const summaryNode = mainNode.clone();
    summaryNode.find('a').first().remove();
    summaryNode.find('strong').remove();
    const summary = cleanText(summaryNode.text()).replace(/^[\s—–-]+/, '');

    const related = [];
    const compactRelated = [];
    const compactXPosts = [];
    const xPosts = [];
    const seenRelated = new Set();
    const seenX = new Set();
    let section = '';

    const addRelated = (item) => {
        if (!item?.href || !item?.title || seenRelated.has(item.href) || item.href === mainUrl) return;
        seenRelated.add(item.href);
        related.push(item);
    };
    const addX = (item) => {
        if (!item?.href || !item?.text || seenX.has(item.href)) return;
        seenX.add(item.href);
        xPosts.push(item);
    };

    for (let index = mainIndex + 1; index < endIndex; index++) {
        const node = $(children[index]);
        const text = cleanText(node.text());
        if (!text || /^<table/i.test(text)) continue;

        const exactLabel = text.match(/^(More|Forums|X|Bluesky|LinkedIn|Mastodon|Threads|Reddit|Hacker News):$/i)?.[1]?.toLowerCase();
        if (exactLabel) {
            section = exactLabel === 'more' ? 'related' : exactLabel;
            continue;
        }

        if (/^More:\s+/i.test(text) && section !== 'related') {
            for (const link of linksFrom(node, $)) {
                compactRelated.push({ href: link.href, title: link.title, source: link.title });
            }
            continue;
        }
        if (/^X:\s+/i.test(text) && section !== 'x') {
            for (const link of linksFrom(node, $).filter(link => /(?:x|twitter)\.com\/[^/]+\/status\//i.test(link.href))) {
                compactXPosts.push({ href: link.href, author: link.title, text: link.title });
            }
            continue;
        }

        if (['related', 'forums', 'bluesky', 'linkedin', 'mastodon', 'threads', 'reddit', 'hacker news'].includes(section)) {
            const links = linksFrom(node, $);
            const markdownLink = markdownLinkFromText(node.text());
            const storyLink = markdownLink || [...links].reverse().find(link => {
                try { return new URL(link.href).pathname.replace(/\/+$/, '').split('/').length > 2; } catch (error) { return false; }
            }) || links.at(-1);
            if (!storyLink) continue;
            const prefix = text.split(':')[0];
            const source = section === 'forums'
                ? `Forum · ${cleanText(prefix).slice(0, 60)}`
                : section === 'related'
                    ? cleanText(prefix.split('/').at(-1) || publisher).slice(0, 60)
                    : `${section.replace(/\b\w/g, value => value.toUpperCase())} · ${cleanText(prefix).slice(0, 45)}`;
            addRelated({ href: storyLink.href, title: storyLink.title, source });
            continue;
        }

        if (section === 'x') {
            const links = linksFrom(node, $);
            const markdownLink = markdownLinkFromText(node.text());
            const postLink = markdownLink || [...links].reverse().find(link => /(?:x|twitter)\.com\/[^/]+\/status\//i.test(link.href));
            if (!postLink) continue;
            const authorLink = links.find(link => /(?:x|twitter)\.com\/[^/]+\/?$/i.test(link.href));
            const postText = cleanText(postLink.title || text.replace(/^[^:]{1,100}:\s*/, ''));
            addX({ href: postLink.href, author: authorLink?.title || cleanText(text.split(':')[0]), text: postText });
        }
    }

    compactRelated.forEach(addRelated);
    if (!xPosts.length) compactXPosts.forEach(addX);
    const html = `<article class="techmeme-story" data-techmeme-story-id="${escapeHtml(storyId)}" data-techmeme-author="${escapeHtml(author)}" data-techmeme-publisher="${escapeHtml(publisher)}" data-techmeme-main-url="${escapeHtml(mainUrl)}">
        <header class="techmeme-main-story">
            <div class="techmeme-main-story__source">${author ? `${escapeHtml(author)} / ` : ''}${escapeHtml(publisher)}</div>
            <h2><a class="article-inline-link" href="${escapeHtml(mainUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(headline)}</a></h2>
            ${summary ? `<p>${escapeHtml(summary)}</p>` : ''}
        </header>
        ${renderRelatedSection(related)}
        ${renderXPosts(xPosts)}
    </article>`;

    return { html, title: headline, author, publisher, mainUrl, related, xPosts };
}

export default class TechmemeSource {
    match(hostname) {
        return hostname === 'techmeme.com' || hostname.endsWith('.techmeme.com');
    }

    parseOpenCliMarkdown(markdown) {
        return { markdown, readerType: 'techmeme-story' };
    }

    isUsableArticleResult(result, context = {}) {
        const content = String(result?.content || '');
        const storyId = storyIdFromUrl(context.url || result?.url || '');
        return content.includes('class="techmeme-story"')
            && (!storyId || content.includes(`data-techmeme-story-id="${storyId}"`));
    }

    cleanCachedArticleContent(content, context = {}) {
        return extractTechmemeStory(content, context.url)?.html || content;
    }

    enhanceArticleResult(result, context = {}) {
        const extracted = extractTechmemeStory(result?.content || '', context.url || result?.url || '');
        if (!extracted) return result;
        const next = { ...result, content: extracted.html };
        if (extracted.title) next.title = extracted.title;
        if (extracted.author) next.author = extracted.author;
        next.primaryArticleUrl = extracted.mainUrl;
        next.primarySource = sourceMetadata(extracted.publisher, extracted.mainUrl);
        if (/techmeme\.com\/(?:img\/)?(?:mg\d+|logo|favicon)/i.test(next.image || '')) next.image = '';
        return next;
    }

    async expandArticleResult(result, context = {}) {
        const enhanced = this.enhanceArticleResult(result, context);
        if (!enhanced?.content || enhanced.content.includes('class="techmeme-primary-article"')) return enhanced;

        const attemptedAt = new Date().toISOString();
        const primaryUrl = canonicalPrimaryArticleUrl(enhanced.primaryArticleUrl);
        if (!primaryUrl || typeof context.fetchPrimaryArticle !== 'function') {
            return { ...enhanced, primaryArticleFetchAttemptedAt: attemptedAt };
        }

        let primary = null;
        try {
            primary = await context.fetchPrimaryArticle(primaryUrl);
        } catch (error) {
            primary = null;
        }
        const primaryText = cleanText(primary?.content || '');
        if (!primary?.content || primaryText.length < 400) {
            return { ...enhanced, primaryArticleFetchAttemptedAt: attemptedAt };
        }

        const $ = cheerio.load(`<main id="techmeme-expanded-root">${enhanced.content}</main>`, null, false);
        const story = $('#techmeme-expanded-root').children('.techmeme-story').first();
        if (!story.length) return { ...enhanced, primaryArticleFetchAttemptedAt: attemptedAt };
        const metadata = enhanced.primarySource || sourceMetadata(primary.siteName, primaryUrl);
        const label = metadata?.name || metadata?.domain || 'main source';
        story.children('.techmeme-main-story').after(`<section class="techmeme-primary-article" aria-label="Article from ${escapeHtml(label)}">
            <div class="techmeme-primary-article__content">${primary.content}</div>
        </section>`);

        return {
            ...enhanced,
            content: $('#techmeme-expanded-root').html(),
            image: safeHttpUrl(primary.image) || enhanced.image || '',
            imageCaption: cleanText(primary.imageCaption) || enhanced.imageCaption || '',
            author: cleanText(primary.author) || enhanced.author || '',
            primarySource: metadata,
            primaryArticleFetched: true,
            primaryArticleFetchStrategy: primary.fetchStrategy || '',
            primaryArticleFetchAttemptedAt: attemptedAt
        };
    }
}
