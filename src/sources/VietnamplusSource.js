import * as cheerio from 'cheerio/slim';

export function trimVietnamplusMarkdown(markdown = '') {
    let source = String(markdown || '').trim();
    if (!source) return source;
    const attribution = source.match(/^\s*\((?:TTXVN|Vietnam\+)[^\n)]*\)\s*$/im)?.[0]?.trim() || '';
    const boundaries = [
        source.search(/\n\s*\[!\[[^\]]*\]\(https?:\/\/[^)]+\)\]\(https?:\/\/(?:www\.)?vietnamplus\.vn\/[^)\s]+\.vnp[^)]*\)\s*\n\s*#{2,4}\s*\[/i),
        source.search(/\n\s*#{2,4}\s*\[Tin c(?:ù|u)ng chuyên m(?:ụ|u)c\]/iu),
        source.search(/\n\s*#{2,4}\s*Tin c(?:ù|u)ng chuyên m(?:ụ|u)c\s*$/imu)
    ].filter(index => index >= 650);
    if (boundaries.length) {
        source = source.slice(0, Math.min(...boundaries)).trim();
        if (attribution && !source.includes(attribution)) source += `\n\n${attribution}`;
    }
    return source;
}

export default class VietnamplusSource {
    match(hostname) {
        return hostname.includes('vietnamplus.vn');
    }

    isUsableArticleResult(result) {
        const content = String(result?.content || '');
        if (!content) return false;
        const $ = cheerio.load(content, null, false);
        const textLength = $.root().text().replace(/\s+/g, ' ').trim().length;
        const paragraphCount = $('p').length;
        const imageCount = $('img').length;
        const hasVideo = $('video, iframe').length > 0;

        // OpenCLI can occasionally land on a trailing recommendation card
        // instead of the VietnamPlus body. A real article has sustained prose;
        // photo/video stories may be shorter but contain multiple media items.
        return (textLength >= 700 && paragraphCount >= 5)
            || (textLength >= 300 && imageCount >= 2)
            || (textLength >= 250 && hasVideo);
    }

    parseJinaReaderText(markdown) {
        return { markdown: trimVietnamplusMarkdown(markdown), readerType: 'vietnamplus-article' };
    }

    parseOpenCliMarkdown(markdown) {
        return { markdown: trimVietnamplusMarkdown(markdown), readerType: 'vietnamplus-article' };
    }

    parseArticleHtmlContent(html, url, result, utils) {
        let articleHtml = '';

        let avatarHtml = '';
        if (utils && utils.extractBalancedElementByClass) {
            const avatarContent = utils.extractBalancedElementByClass(html, 'article__avatar');
            if (avatarContent && (avatarContent.includes('<video') || avatarContent.includes('<iframe'))) {
                avatarHtml = `<div class="article-avatar">${avatarContent}</div>`;
            }
        }

        const balancedBody = utils?.extractBalancedElementByClass?.(html, 'article__body') || '';
        const articleBodyMatch = balancedBody
            ? null
            : html.match(/<div\b[^>]*class=["'][^"']*article__body[^"']*["'][^>]*>([\s\S]*?)(?:<div\b[^>]*class=["'][^"']*article__tag|<div\b[^>]*class=["'][^"']*article__author)/i);
        if (balancedBody || articleBodyMatch) {
            articleHtml = balancedBody || articleBodyMatch[1];
            if (avatarHtml) articleHtml = avatarHtml + articleHtml;
        } else if (avatarHtml) {
            articleHtml = avatarHtml;
        } else {
            return false;
        }

        const createSuggestedHtml = (title, itemsHtml) => {
            if (!itemsHtml) return '';
            return `
<div class="embedded-suggested-articles">
    <div class="embedded-suggested-header">
        <svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>
        ${title}
    </div>
    <div class="embedded-suggested-carousel">
        ${itemsHtml}
    </div>
</div>`;
        };

        const createCardHtml = (href, title, img, desc) => {
            let absUrl = href;
            try { absUrl = href.startsWith('/') ? new URL(href, url).href : href; } catch(e) {}
            return `
            <div class="embedded-suggested-card">
                <a href="${absUrl}" target="_blank" class="embedded-suggested-overlay"></a>
                ${img ? `<img src="${img}" class="embedded-suggested-image" alt="">` : ''}
                <div class="embedded-suggested-content">
                    <div class="embedded-suggested-title">${title}</div>
                    ${desc ? `<div class="embedded-suggested-summary">${desc}</div>` : ''}
                </div></div>`;
        };

        const allRelatedItems = [];
        const addItem = (href, title, img, desc) => {
            let absUrl = href;
            try { absUrl = href.startsWith('/') ? new URL(href, url).href : href; } catch(e) {}
            if (!allRelatedItems.some(item => item.href === absUrl)) {
                allRelatedItems.push({ href: absUrl, title, img, desc });
            }
        };

        const $ = cheerio.load(`<main id="vietnamplus-reader-root">${articleHtml}</main>`, null, false);
        const root = $('#vietnamplus-reader-root');
        root.find('.article__social, .sda_middle, .rennab, script, style, template, form').remove();
        root.find('.article-relate').each((_, element) => {
            const related = $(element);
            related.find('article').each((__, itemElement) => {
                const item = $(itemElement);
                const link = item.find('a[href]').first();
                const href = link.attr('href') || '';
                const title = link.attr('title') || item.find('h2,h3,h4').first().text() || link.text();
                const image = item.find('img').first();
                const imageUrl = image.attr('data-src') || image.attr('src') || '';
                if (href && title.trim()) addItem(href, title.replace(/<[^>]+>/g, '').trim(), imageUrl, '');
            });
            related.remove();
        });
        articleHtml = root.html();

        if (allRelatedItems.length > 0) {
            let itemsHtml = '';
            for (const item of allRelatedItems) {
                itemsHtml += createCardHtml(item.href, item.title, item.img, item.desc);
            }
            articleHtml += createSuggestedHtml('BÀI VIẾT LIÊN QUAN', itemsHtml);
        }

        return articleHtml;
    }
}
