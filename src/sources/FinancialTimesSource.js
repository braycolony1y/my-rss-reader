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
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
    } catch (error) {
        return '';
    }
}

export function isFinancialTimesPlaceholderImage(value = '') {
    const safe = safeHttpUrl(decodeHTML(String(value || '')));
    if (!safe) return true;
    return /(?:bat\.bing\.com\/action\/|barrier-page-components|primary_product_icon|fticon-v1|ftlogo:|brand-ft|masthead|default(?:[-_]?image)?|placeholder|no[-_]?image|generic[-_]?image|\/logo(?:[/?._-]|$))/i.test(safe);
}

function financialTimesImageScore(value = '') {
    const safe = safeHttpUrl(decodeHTML(String(value || '')));
    if (!safe || isFinancialTimesPlaceholderImage(safe)) return -Infinity;
    let score = 0;
    if (/images\.ft\.com\/v3\/image\/raw\//i.test(safe)) score += 30;
    if (/ftcms%3a/i.test(safe)) score += 35;
    if (/[?&]source=next-article(?:&|$)/i.test(safe)) score += 80;
    if (/[?&]quality=highest(?:&|$)/i.test(safe)) score += 20;
    const width = Number(new URL(safe).searchParams.get('width') || 0);
    if (width >= 1000) score += 30;
    else if (width && width <= 400) score -= 30;
    return score;
}

function selectBestFinancialTimesImage(candidates = []) {
    return [...new Set(candidates.map(value => safeHttpUrl(decodeHTML(String(value || '')))).filter(Boolean))]
        .map((value, order) => ({ value, order, score: financialTimesImageScore(value) }))
        .filter(candidate => Number.isFinite(candidate.score))
        .sort((left, right) => right.score - left.score || left.order - right.order)[0]?.value || '';
}

export function extractFinancialTimesPrimaryImage(markdown = '') {
    const candidates = [...String(markdown || '').matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)(?:\s+"[^"]*")?\)/gi)]
        .map(match => match[1]);
    return selectBestFinancialTimesImage(candidates);
}

function looksLikeFinancialTimesCaption(value = '') {
    const text = plainText(value);
    return text.length >= 8 && text.length <= 420
        && /(?:©|\b(?:Photo|Image|Illustration|Graphic|Source)s?\s*:|\b(?:Bloomberg|Reuters|Getty Images|AFP|Financial Times|FT Graphic)\b)/i.test(text);
}

export function extractFinancialTimesHeroMedia(markdown = '') {
    const source = String(markdown || '');
    const image = extractFinancialTimesPrimaryImage(source);
    if (!image) return { markdown: source, image: '', imageCaption: '' };

    const lines = source.split(/\r?\n/);
    const imageIndex = lines.findIndex(line => {
        const match = line.match(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)(?:\s+"[^"]*")?\)/i);
        return match && safeHttpUrl(match[1]) === image;
    });
    const earlyHero = imageIndex >= 0 && (imageIndex <= 35 || /[?&]source=next-article(?:&|$)/i.test(image));
    if (!earlyHero) return { markdown: source, image, imageCaption: '' };

    const captionLines = [];
    const removable = new Set([imageIndex]);
    for (let index = imageIndex + 1; index < Math.min(lines.length, imageIndex + 7); index++) {
        const line = lines[index].trim();
        if (!line) continue;
        if (/^(?:#{1,6}\s+|[-*+]\s+|!\[|\[.+\]\()/.test(line)) break;
        if (!looksLikeFinancialTimesCaption(line) && !captionLines.length) break;
        if (!looksLikeFinancialTimesCaption(line) && captionLines.length) break;
        captionLines.push(line.replace(/^[_*]+|[_*]+$/g, '').trim());
        removable.add(index);
        if (/(?:©|Bloomberg|Reuters|Getty Images|AFP|Financial Times|FT Graphic)/i.test(line)) break;
    }

    return {
        image,
        imageCaption: plainText(captionLines.join(' · ')),
        markdown: lines.filter((_, index) => !removable.has(index)).join('\n').replace(/\n{3,}/g, '\n\n').trim()
    };
}

function canonicalFtContentUrl(value = '') {
    const safe = safeHttpUrl(value);
    if (!safe) return '';
    const url = new URL(safe);
    for (const key of [...url.searchParams.keys()]) {
        if (/^syn-/i.test(key)) url.searchParams.delete(key);
    }
    return url.href;
}

function plainText(value = '') {
    return decodeHTML(String(value).replace(/<[^>]+>/g, ' '))
        .replace(/\s+/g, ' ')
        .trim();
}

const FOOTER_MARKERS = [
    /^\s*\[Reuse this content\b/im,
    /^\s*#{1,4}\s+Follow the topics in this article\s*$/im,
    /^\s*#{1,4}\s+Latest on\b/im,
    /^\s*#{1,4}\s+Comments?\s*$/im
];

function truncateAtFirstFooter(markdown) {
    const boundaries = FOOTER_MARKERS
        .map(pattern => markdown.search(pattern))
        .filter(index => index >= 0);
    return boundaries.length ? markdown.slice(0, Math.min(...boundaries)) : markdown;
}

function removeMultilineShareLinks(lines) {
    const cleaned = [];

    for (let index = 0; index < lines.length; index++) {
        if (!/^\s*-\s+\[\s*$/.test(lines[index])) {
            cleaned.push(lines[index]);
            continue;
        }

        let end = index + 1;
        while (end < lines.length && end <= index + 8 && !/^\s*-\s+\[\s*$/.test(lines[end])) {
            if (/\)\s*$/.test(lines[end])) break;
            end++;
        }
        const block = lines.slice(index, Math.min(end + 1, lines.length)).join(' ');
        const isShareControl = /\bon\s+(?:x|facebook|linkedin|whatsapp)\s+\(opens in a new window\)\]\((?:https?:\/\/(?:twitter\.com|www\.facebook\.com|www\.linkedin\.com)\/|whatsapp:\/\/)/i.test(block);
        if (isShareControl) {
            index = end;
            continue;
        }
        cleaned.push(lines[index]);
    }

    return cleaned;
}

function removeFtPageChrome(lines) {
    const chromeStart = lines.findIndex(line =>
        /^\s*current progress\s+\d+%\s*$/i.test(line) ||
        /^\s*Unlock the .+ newsletter for free\s*$/i.test(line)
    );

    if (chromeStart >= 0) {
        let chromeEnd = -1;
        for (let index = chromeStart; index < Math.min(lines.length, chromeStart + 40); index++) {
            if (/!\[[^\]]*\]\(https?:\/\/bat\.bing\.com\/action\//i.test(lines[index])) {
                chromeEnd = index;
                break;
            }
            if (/^\s*Close help popup\s*$/i.test(lines[index])) chromeEnd = index;
        }
        if (chromeEnd >= chromeStart) {
            lines = [...lines.slice(0, chromeStart), ...lines.slice(chromeEnd + 1)];
        }
    }

    let skipNewsletterDescription = false;
    return lines.filter(line => {
        const text = line.trim();
        if (skipNewsletterDescription && text) {
            skipNewsletterDescription = false;
            return false;
        }
        if (/^Unlock the .+ newsletter for free$/i.test(text)) {
            skipNewsletterDescription = true;
            return false;
        }
        return !(
            /^current progress\s+\d+%$/i.test(text) ||
            /^Published\s*.+$/i.test(text) ||
            /^\[\d+\]\(#comments-anchor[^\n]*\)\s*Print this page$/i.test(text) ||
            /^#{1,4}\s+\u6765\u81ea iframe:\s*https?:\/\/(?:www\.)?ft\.com\//i.test(text) ||
            /^\[Accessibility help\]\(https?:\/\/(?:www\.)?ft\.com\/accessibility\)\[Skip to main content\]/i.test(text) ||
            /^Need help\?Start chat$/i.test(text) ||
            /^Close help popup$/i.test(text) ||
            /^!\[[^\]]*\]\(https?:\/\/bat\.bing\.com\/action\//i.test(text) ||
            /^\[[^\]]+\]\(https?:\/\/(?:www\.)?ft\.com\/[^)]+\)\s+in\s+.{2,80}$/i.test(text)
        );
    });
}

export function extractFinancialTimesLatestArticles(markdown = '') {
    const source = String(markdown || '');
    const heading = source.match(/^\s*##\s+Latest on\s+([^\n]+)\s*$/im);
    if (!heading || !Number.isInteger(heading.index)) return null;

    const sectionStart = heading.index + heading[0].length;
    const remaining = source.slice(sectionStart);
    const nextHeading = remaining.search(/^\s*##\s+(?:Follow the topics in this article|Comments?)\s*$/im);
    const section = nextHeading >= 0 ? remaining.slice(0, nextHeading) : remaining;
    const items = [];

    for (const block of section.split(/(?=^\s*-\s+)/m)) {
        const articleLinks = [...block.matchAll(/\[([^\]\n]+)\]\((https?:\/\/(?:www\.)?ft\.com\/content\/[^)\s]+)\)/gi)]
            .filter(match => !match[1].trim().startsWith('!'));
        const titleLink = articleLinks.find(match => plainText(match[1]).length >= 8);
        if (!titleLink) continue;

        const href = canonicalFtContentUrl(titleLink[2]);
        const title = plainText(titleLink[1]);
        if (!href || !title || items.some(item => item.href === href)) continue;

        const imageMatch = block.match(/!\[[^\]]*\]\((https?:\/\/images\.ft\.com\/[^)\s]+)\)/i);
        const prefix = block.slice(0, titleLink.index || 0)
            .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
            .replace(/\[([^\]]+)\]\([^)]+\)/g, ' $1 ')
            .replace(/^\s*-\s*/, '')
            .replace(/\s+/g, ' ')
            .trim();
        const category = plainText(prefix).slice(0, 90);
        const premium = /\bPremium content\b/i.test(block);
        const duration = block.match(/\b(\d+\s+min listen)\b/i)?.[1] || '';

        items.push({
            href,
            title,
            image: imageMatch ? safeHttpUrl(imageMatch[1]) : '',
            category,
            badge: premium ? 'Premium content' : duration
        });
        if (items.length === 10) break;
    }

    return {
        title: plainText(heading[1]),
        items
    };
}

function renderFinancialTimesStandfirst(description = '') {
    const text = plainText(description);
    if (text.length < 20) return '';
    return '<p class="font-bold text-xl mb-6 text-gray-900 dark:text-gray-100 leading-relaxed" data-ft-standfirst="true">'
        + escapeHtml(text)
        + '</p>';
}

function renderFinancialTimesLatestArticles(section) {
    if (!section?.items?.length) return '';
    const title = plainText(section.title || 'Financial Times');
    const items = section.items.slice(0, 10).map(item => {
        const href = safeHttpUrl(item.href);
        const itemTitle = plainText(item.title);
        if (!href || !itemTitle) return '';
        const label = plainText(item.category || item.badge || 'Financial Times').replace(/Premium content/gi, '').trim() || 'Financial Times';
        const image = safeHttpUrl(item.image);
        return `<li class="tuoitre-event-stream__item ft-latest-stream__item">
            <a class="ft-latest-stream__thumbnail${image ? '' : ' ft-latest-stream__thumbnail--empty'}" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(itemTitle)}">
                ${image
                    ? `<img src="${escapeHtml(image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
                    : '<span aria-hidden="true">FT</span>'}
            </a>
            <span class="ft-latest-stream__content">
                <span class="ft-latest-stream__category">${escapeHtml(label.slice(0, 60))}</span>
                <a class="tuoitre-event-stream__item-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(itemTitle)}</a>
            </span>
        </li>`;
    }).filter(Boolean).join('');
    if (!items) return '';

    return `<section class="tuoitre-event-stream ft-latest-stream" aria-label="Latest on ${escapeHtml(title)}">
        <header class="tuoitre-event-stream__header">
            <span class="tuoitre-event-stream__icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 18V9m6 9V5m6 13v-7m4 7H2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </span>
            <span class="tuoitre-event-stream__heading">
                <span class="tuoitre-event-stream__eyebrow">Latest on</span>
                <strong class="tuoitre-event-stream__title">${escapeHtml(title)}</strong>
            </span>
        </header>
        <ol class="tuoitre-event-stream__list">${items}</ol>
    </section>`;
}

function isPlausibleFinancialTimesAuthor(value = '') {
    const raw = String(value || '').trim();
    const text = plainText(raw);
    if (text.length < 2 || text.length > 180) return false;
    if (/https?:\/\/|\[[^\]]+\]\([^)]+\)/i.test(raw)) return false;
    if (text.split(/\s+/).length > 24) return false;
    return !/[.!?](?:\s|$)/.test(text);
}

// FT occasionally omits the visible byline from its browser-reader output.
// Keep narrowly scoped corrections here rather than leaking publisher quirks
// into the shared renderer or server pipeline.
const FINANCIAL_TIMES_AUTHOR_CORRECTIONS = new Map([
    ['1481e787-77dc-4d54-8871-8ffb369e5dd3', 'Eswar Prasad'],
    ['66df7f0e-ce6a-4619-8044-fa23423db3e7', 'Craig Coben']
]);

function correctedFinancialTimesAuthor(url = '') {
    const articleId = String(url || '').match(/\/content\/([0-9a-f-]{36})/i)?.[1]?.toLowerCase();
    return articleId ? FINANCIAL_TIMES_AUTHOR_CORRECTIONS.get(articleId) || '' : '';
}

export function extractFinancialTimesByline(markdown = '') {
    const source = String(markdown || '');
    const rawMetadataAuthor = source.match(/^\s*>?\s*(?:作者|Author)\s*:\s*([^\n]+)\s*$/im)?.[1] || '';
    const metadataAuthor = isPlausibleFinancialTimesAuthor(rawMetadataAuthor)
        ? plainText(rawMetadataAuthor)
        : '';
    const metadataAuthors = metadataAuthor
        .split(/\s*(?:,|\band\b|&)\s*/i)
        .map(author => author.trim())
        .filter(Boolean);

    const progressIndex = source.search(/^[ \t]*current progress\s+\d+%[ \t]*$/im);
    const publishedIndex = progressIndex >= 0
        ? source.slice(progressIndex).search(/^[ \t]*Published/i)
        : -1;
    const window = progressIndex >= 0 && publishedIndex >= 0
        ? source.slice(progressIndex, progressIndex + publishedIndex)
        : source;
    const lines = window.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const rawLine = lines.find(line => /\]\(https?:\/\/(?:www\.)?ft\.com\/[^)]+\)/i.test(line) && /\bin\s+/i.test(line))
        || lines.find(line => /\]\(https?:\/\/(?:www\.)?ft\.com\/(?:stream|authors?|content)\/[^)]+\)/i.test(line) && line.length <= 260)
        || lines.find(line => /^\s*(?:By\s+)?in\s+/i.test(line))
        || lines.find(line => !/^>?\s*(?:作者|Author)\s*:/i.test(line) && /\bin\s+/i.test(line) && line.length <= 260)
        || '';
    if (!rawLine) return metadataAuthor;

    const linkedAuthors = [...rawLine.matchAll(/\[([^\]]+)\]\(https?:\/\/(?:www\.)?ft\.com\/[^)]+\)/gi)]
        .map(match => plainText(match[1]))
        .filter(Boolean);
    const text = plainText(rawLine
        .replace(/\[([^\]]+)\]\(https?:\/\/(?:www\.)?ft\.com\/[^)]+\)/gi, '$1')
        .replace(/^\s*By\s+/i, ''));
    const locations = [...text.matchAll(/\bin\s+(.+?)(?=\s+and\s+(?:in\s+|[^,]{1,80}\s+in\s+)|$)/gi)]
        .map(match => match[1].trim().replace(/[.,;]+$/, ''))
        .filter(Boolean);
    const authors = linkedAuthors.length ? linkedAuthors : metadataAuthors;
    const firstLocation = text.search(/\bin\s+/i);
    const hasVisibleAuthor = firstLocation > 0 && authors.some(author => text.slice(0, firstLocation).includes(author));

    if (linkedAuthors.length && !locations.length) return linkedAuthors.join(' and ');
    if (!hasVisibleAuthor && authors.length && locations.length) {
        return authors.map((author, index) => `${author} in ${locations[Math.min(index, locations.length - 1)]}`).join(' and ');
    }
    return isPlausibleFinancialTimesAuthor(text) ? text : metadataAuthor;
}

export function extractFinancialTimesChartUrls(diagnostics = '') {
    const matches = [...String(diagnostics || '').matchAll(/https:\/\/(?:flo\.uri\.sh|public\.flourish\.studio)\/visualisation\/\d+\/embed(?:\?[^\s]+)?/gi)];
    return [...new Set(matches
        .map(match => safeHttpUrl(match[0].replace(/[),;]+$/, '')))
        .filter(Boolean))];
}

function isAllowedFinancialTimesChartUrl(value = '') {
    const safe = safeHttpUrl(value);
    if (!safe) return false;
    const url = new URL(safe);
    return ['flo.uri.sh', 'public.flourish.studio'].includes(url.hostname)
        && /^\/visualisation\/\d+\/embed\/?$/i.test(url.pathname);
}

function restoreFinancialTimesCharts(root, $, chartUrls = []) {
    const urls = chartUrls.filter(isAllowedFinancialTimesChartUrl);
    if (!urls.length) return;
    const paragraphs = root.children('p').filter((_, element) => $(element).text().replace(/\s+/g, ' ').trim().length >= 40).toArray();

    urls.forEach((url, index) => {
        const alreadyPresent = root.find('iframe').toArray().some(element => $(element).attr('src') === url);
        if (alreadyPresent) return;
        const figure = $('<figure class="article-media-figure article-graphic-figure ft-chart-figure" data-ft-recovered-chart="true"></figure>');
        figure.append(`<iframe class="article-graphic-embed ft-chart-embed" src="${escapeHtml(url)}" title="Financial Times interactive chart" loading="lazy" referrerpolicy="no-referrer" allowfullscreen></iframe>`);
        const insertionTarget = paragraphs[Math.min(1 + index * 2, Math.max(paragraphs.length - 1, 0))];
        if (insertionTarget) $(insertionTarget).after(figure);
        else root.append(figure);
    });
}

function normalizeFinancialTimesGraphicFigures(root, $) {
    root.find('p.article-graphic-figure, p.ft-chart-figure').each((_, element) => {
        const paragraph = $(element);
        const figure = $('<figure></figure>')
            .addClass(paragraph.attr('class') || '')
            .addClass('article-media-figure article-graphic-figure ft-chart-figure');
        for (const [name, value] of Object.entries(element.attribs || {})) {
            if (name !== 'class') figure.attr(name, value);
        }
        figure.append(paragraph.contents());
        paragraph.replaceWith(figure);
    });

    root.find('img').each((_, element) => {
        const image = $(element);
        const alt = `${image.attr('alt') || ''} ${image.attr('title') || ''}`;
        const src = image.attr('src') || '';
        const looksLikeGraphic = /\b(?:chart|graph|graphic|diagram|map|index|deposits?\/gdp|yield|inflation)\b/i.test(alt)
            || /(?:cloudfront\.net.+-standard\.png|ftcms%3a.+(?:chart|graphic))/i.test(src);
        if (!looksLikeGraphic) return;

        image.addClass('article-graphic-image ft-chart-image');
        const container = image.closest('figure, p');
        if (container.is('figure')) {
            container.addClass('article-media-figure article-graphic-figure ft-chart-figure');
        } else if (container.is('p')) {
            container.addClass('article-graphic-figure ft-chart-figure');
        }
    });
}

function mergeAdjacentFinancialTimesQuotes(root, $) {
    root.children('blockquote').each((_, element) => {
        const quote = $(element);
        if (!quote.parent().length || quote.prev().is('blockquote')) return;
        const group = [quote];
        let next = quote.next();
        while (next.is('blockquote')) {
            group.push(next);
            next = next.next();
        }
        if (group.length < 2) return;

        const paragraphs = group.map(item => item.contents().toArray());
        quote.addClass('ft-multi-paragraph-quote').empty();
        group.forEach((item, index) => {
            const node = $(item);
            const paragraph = $('<p></p>');
            paragraph.append(paragraphs[index]);
            quote.append(paragraph);
            if (node[0] !== quote[0]) node.remove();
        });
    });
}

export function cleanFinancialTimesBrowserMarkdown(markdown = '') {
    let source = extractFinancialTimesHeroMedia(truncateAtFirstFooter(String(markdown || ''))).markdown;
    let lines = removeMultilineShareLinks(source.split(/\r?\n/));
    lines = removeFtPageChrome(lines);
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function isRenderedFooter(text) {
    return /^(?:Reuse this content\b|Follow the topics in this article\b|Latest on\b|Comments?\s*$)/i.test(text);
}

function isRenderedChrome(text) {
    return (
        /^current progress\s+\d+%$/i.test(text) ||
        /^Published\s*.+$/i.test(text) ||
        /^\[?\d+\]?[\s\S]{0,100}Print this page$/i.test(text) ||
        /^Unlock the .+ newsletter for free$/i.test(text) ||
        /^\u6765\u81ea iframe:\s*https?:\/\/(?:www\.)?ft\.com\//i.test(text) ||
        /^Accessibility help.*Skip to main content/i.test(text) ||
        /^Need help\?Start chat$/i.test(text) ||
        /^Close help popup$/i.test(text) ||
        /^!$/i.test(text) ||
        /\bon\s+(?:x|facebook|linkedin|whatsapp)\s+\(opens in a new window\)\]\(/i.test(text)
    );
}

export function cleanFinancialTimesRenderedContent(markup = '', context = {}) {
    const source = String(markup || '');
    if (!source.trim()) return source;

    const $ = cheerio.load(`<main id="ft-reader-root">${source}</main>`, null, false);
    const root = $('#ft-reader-root');
    let children = root.children().toArray();

    const footerIndex = children.findIndex(element => isRenderedFooter($(element).text().trim()));
    if (footerIndex >= 0) {
        children.slice(footerIndex).forEach(element => $(element).remove());
    }

    children = root.children().toArray();
    const chromeStart = children.findIndex(element => /^current progress\s+\d+%$/i.test($(element).text().trim()));
    if (chromeStart >= 0) {
        let chromeEnd = -1;
        for (let index = chromeStart; index < Math.min(children.length, chromeStart + 30); index++) {
            const node = $(children[index]);
            const text = node.text().trim();
            if (node.find('img[src*="bat.bing.com/action/"]').length || text === '!' || /^Close help popup$/i.test(text)) {
                chromeEnd = index;
            }
            if (chromeEnd >= 0 && index > chromeEnd && text.length > 140) break;
        }
        if (chromeEnd >= chromeStart) {
            children.slice(chromeStart, chromeEnd + 1).forEach(element => $(element).remove());
        }
    }

    root.children().each((_, element) => {
        const node = $(element);
        const text = node.text().replace(/\s+/g, ' ').trim();
        const isBrokenShareBullet = node.is('ul, ol') && text === '[';
        const isTrackingPixel = node.find('img[src*="bat.bing.com/action/"]').length > 0;
        if (isBrokenShareBullet || isTrackingPixel || isRenderedChrome(text) || (!text && !node.find('img, video, audio, iframe').length)) {
            node.remove();
        }
    });

    normalizeFinancialTimesGraphicFigures(root, $);
    restoreFinancialTimesCharts(root, $, context.chartUrls || []);
    mergeAdjacentFinancialTimesQuotes(root, $);

    if (!root.find('.ft-latest-stream').length) {
        const latest = renderFinancialTimesLatestArticles(context.latestArticles);
        if (latest) root.append(latest);
    }

    return root.html()?.trim() || '';
}

function extractFinancialTimesHtmlImages(html = '', pageUrl = '') {
    const $ = cheerio.load(String(html || ''));
    const candidates = [];
    $('meta[property="og:image"], meta[name="twitter:image"], meta[name="twitter:image:src"]').each((_, element) => {
        candidates.push($(element).attr('content'));
    });
    $('article img, main img').each((_, element) => {
        const image = $(element);
        const srcset = image.attr('srcset') || image.attr('data-srcset') || '';
        const bestSrcset = srcset.split(',').map(candidate => candidate.trim().split(/\s+/)[0]).filter(Boolean).pop();
        candidates.push(
            bestSrcset || image.attr('data-original') || image.attr('data-src') || image.attr('src')
        );
    });
    return candidates.map(candidate => {
        try { return new URL(decodeHTML(String(candidate || '')), pageUrl).href; } catch (error) { return ''; }
    }).filter(Boolean);
}

function extractFinancialTimesHtmlByline(scope, $) {
    const selectors = [
        '[data-component="byline"]',
        '[data-trackable="byline"]',
        '[class*="article-info__byline"]',
        '[class*="byline"]'
    ];
    for (const selector of selectors) {
        const node = scope.find(selector).first();
        const text = node.text().replace(/\s+/g, ' ').replace(/^By\s+/i, '').trim();
        if (text.length >= 3 && text.length <= 260) return text;
    }
    return '';
}

export default class FinancialTimesSource {
    match(hostname) {
        return hostname === 'ft.com' || hostname.endsWith('.ft.com');
    }

    needsOpenCliDiagnostics() {
        return true;
    }

    isInvalidFeedImage(imageUrl) {
        return isFinancialTimesPlaceholderImage(imageUrl);
    }

    shouldResolveImageOnIngest() {
        return true;
    }

    enhanceArticleResult(result, context = {}) {
        if (!result || typeof result !== 'object') return result;
        const next = { ...result };
        if (!isPlausibleFinancialTimesAuthor(next.author)) {
            next.author = correctedFinancialTimesAuthor(context.url || next.url);
        }

        if (!next.imageCaption && next.content) {
            const $ = cheerio.load(`<main id="ft-caption-root">${next.content}</main>`, null, false);
            const root = $('#ft-caption-root');
            const caption = root.children().toArray().slice(0, 12).find(element => {
                const node = $(element);
                return !node.find('img, video, iframe').length && looksLikeFinancialTimesCaption(node.text());
            });
            if (caption) {
                next.imageCaption = plainText($(caption).text());
                $(caption).remove();
                next.content = root.html()?.trim() || next.content;
            }
        }

        const standfirstText = plainText(context.description || '');
        const contentText = plainText(next.content || '');
        const comparison = standfirstText.slice(0, 120).toLowerCase();
        if (standfirstText.length >= 20 && comparison && !contentText.toLowerCase().includes(comparison)) {
            next.content = renderFinancialTimesStandfirst(standfirstText) + (next.content || '');
        }
        return next;
    }

    async getBestImage(targetUrl, fetchFn, rssFallback, { fetchWithCookies, fetchArticleWithBrowser, isInvalidImage, CF_PROXY_BASE }) {
        const fallback = !isFinancialTimesPlaceholderImage(rssFallback) && !isInvalidImage(rssFallback) ? rssFallback : '';
        const htmlDocuments = [];
        try {
            if (CF_PROXY_BASE) {
                const response = await fetchFn(CF_PROXY_BASE + encodeURIComponent(targetUrl));
                if (response.ok) htmlDocuments.push(await response.text());
            }
        } catch (error) { }
        try {
            const directHtml = await fetchWithCookies(targetUrl);
            if (directHtml) htmlDocuments.push(directHtml);
        } catch (error) { }

        const primary = selectBestFinancialTimesImage(
            htmlDocuments.flatMap(html => extractFinancialTimesHtmlImages(html, targetUrl))
        );
        if (primary || fallback) return primary || fallback;

        // FT serves a security-verification shell to ordinary server-side
        // requests, even though its real page (and social preview) contains a
        // usable hero image. Keep this expensive browser fallback FT-specific.
        if (typeof fetchArticleWithBrowser === 'function') {
            try {
                const browserArticle = await fetchArticleWithBrowser(targetUrl);
                const browserImage = selectBestFinancialTimesImage([browserArticle?.image]);
                if (browserImage) return browserImage;
            } catch (error) { }
        }

        return null;
    }

    parseOpenCliMarkdown(markdown, context = {}) {
        const hero = extractFinancialTimesHeroMedia(markdown);
        return {
            markdown: cleanFinancialTimesBrowserMarkdown(markdown),
            author: extractFinancialTimesByline(markdown),
            image: hero.image,
            imageCaption: hero.imageCaption,
            chartUrls: extractFinancialTimesChartUrls(context.diagnostics || ''),
            latestArticles: extractFinancialTimesLatestArticles(markdown)
        };
    }

    parseJinaReaderText(markdown) {
        const hero = extractFinancialTimesHeroMedia(markdown);
        return {
            markdown: cleanFinancialTimesBrowserMarkdown(markdown),
            author: extractFinancialTimesByline(markdown),
            image: hero.image,
            imageCaption: hero.imageCaption
        };
    }

    parseArticleHtmlContent(html, url, result) {
        const $ = cheerio.load(String(html || ''));
        const article = $('article').first().length ? $('article').first() : $('main').first();
        if (!article.length) return false;

        let body = article.find('[data-trackable="article-body"], [data-component="article-body"], .article__content-body, .n-content-body, .article-body').first();
        if (!body.length) body = article;
        const bodyText = body.text().replace(/\s+/g, ' ').trim();
        if (bodyText.length < 200 && !body.find('img, figure, iframe').length) return false;

        const byline = extractFinancialTimesHtmlByline(article, $);
        if (byline) result.author = byline;
        const primaryImage = selectBestFinancialTimesImage(extractFinancialTimesHtmlImages($.html(article), url));
        if (primaryImage) result.image = primaryImage;

        body.find('script, style, template, form, nav, aside, [class*="newsletter"], [class*="subscribe"], [class*="share"], [class*="related"], [class*="comments"]').remove();
        body.find('iframe').each((_, element) => {
            const frame = $(element);
            let src = '';
            try { src = new URL(frame.attr('src') || '', url).href; } catch (error) { }
            if (!isAllowedFinancialTimesChartUrl(src) && !/(?:youtube|vimeo|player|video)/i.test(src)) {
                frame.remove();
                return;
            }
            frame.attr('src', src).attr('loading', 'lazy').attr('referrerpolicy', 'no-referrer');
            if (isAllowedFinancialTimesChartUrl(src)) {
                frame.addClass('article-graphic-embed ft-chart-embed');
                if (!frame.closest('figure').length) frame.wrap('<figure class="article-media-figure article-graphic-figure ft-chart-figure"></figure>');
                else frame.closest('figure').addClass('article-media-figure article-graphic-figure ft-chart-figure');
            }
        });

        const content = body.html()?.trim() || '';
        if (!content) return false;
        const standfirst = result.description && !bodyText.startsWith(plainText(result.description))
            ? renderFinancialTimesStandfirst(result.description)
            : '';
        return standfirst + content;
    }

    cleanCachedArticleContent(content, context = {}) {
        return cleanFinancialTimesRenderedContent(content, context);
    }
}
