export default class TuoitreSource {
    match(hostname) {
        return hostname.includes('tuoitre.vn');
    }

    parseArticleHtmlContent(html, url, result, utils) {
        let articleHtml = '';
        const articleBodyMatch = html.match(/<div\b[^>]*class=["'][^"']*detail-cmain[^"']*["'][^>]*>([\s\S]*?)(?:<div\b[^>]*class=["'][^"']*readmore-body-box[^"']*["']|<div\b[^>]*id=["']tuoitre-tag-detail)/i) ||
                                 html.match(/<div\b[^>]*class=["'][^"']*detail-content[^"']*["'][^>]*>([\s\S]*?)(?:<div\b[^>]*class=["'][^"']*readmore-body-box[^"']*["']|<div\b[^>]*id=["']tuoitre-tag-detail)/i);
        
        if (articleBodyMatch) {
            articleHtml = articleBodyMatch[1];
        } else {
            const match = html.match(/<div\b[^>]*class=["'][^"']*detail-content[^"']*["'][^>]*>([\s\S]*?)(?:<div\b[^>]*class=["']tags[^"']*["']|<div\b[^>]*class=["']footer-content)/i);
            articleHtml = match ? match[1] : html;
        }

        const createSuggestedHtml = (title, itemsHtml) => {
            if (!itemsHtml) return '';
            return `<div class="embedded-suggested-articles"><div class="embedded-suggested-header"><svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>${title}</div><div class="embedded-suggested-carousel">${itemsHtml}</div></div>`;
        };

        const createCardHtml = (href, title, img, desc) => {
            let absUrl = href;
            try { absUrl = href.startsWith('/') ? new URL(href, url).href : href; } catch(e) {}
            let mediaHtml = '';
            if (img) mediaHtml = img.toLowerCase().endsWith('.mp4') ? `<video src="${img}" class="embedded-suggested-image" autoplay muted loop playsinline></video>` : `<img src="${img}" class="embedded-suggested-image" alt="">`;
            return `<div class="embedded-suggested-card"><a href="${absUrl}" target="_blank" class="embedded-suggested-overlay"></a>${mediaHtml}<div class="embedded-suggested-content"><div class="embedded-suggested-title">${title}</div>${desc ? `<div class="embedded-suggested-summary">${desc}</div>` : ''}</div></div>`;
        };

        const allRelatedItems = [];
        const addItem = (itemUrl, title, img, desc, prepend = false) => {
            try {
                const absUrl = new URL(itemUrl, url).href;
                if (absUrl && !allRelatedItems.some(item => item.href === absUrl)) {
                    const item = { href: absUrl, title, img, desc };
                    if (prepend) allRelatedItems.unshift(item);
                    else allRelatedItems.push(item);
                }
            } catch (e) {}
        };

        // Extract Topic/Event Links first
        const topicMatch = html.match(/<div\b[^>]*class=["'][^"']*detail__topic[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
        if (topicMatch) {
            const topicLinks = [...topicMatch[1].matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
            topicLinks.forEach(m => addItem(m[1], m[2].replace(/<[^>]+>/g, '').trim(), '', ''));
        }

        // Inline RelatedOneNews
        articleHtml = articleHtml.replace(/<div\b[^>]*type=["']RelatedOneNews["'][^>]*>([\s\S]*?)<\/div>/gi, (m, inner) => {
            const urlMatch = inner.match(/<a\b[^>]*href=["']([^"']+)["']/i);
            const titleMatch = inner.match(/class=["']OneNewsTitle["'][^>]*>([^<]+)<\/a>/i);
            const descMatch = inner.match(/<p\b[^>]*class=["'][^"']*VCObjectBoxRelatedNewsItemSapo[^"']*["'][^>]*>([\s\S]*?)<\/p>/i);
            if (urlMatch && titleMatch) {
                const img = (inner.match(/<source\b[^>]*(?:data-src|src)=["']([^"']+)["']/i) || inner.match(/<img\b[^>]*src=["']([^"']+)["']/i) || inner.match(/<video\b[^>]*poster=["']([^"']+)["']/i) || [])[1] || '';
                addItem(urlMatch[1], titleMatch[1].trim(), img, descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : '', true);
            }
            return '';
        });

        // Format Box Note / Summary (VCSortableInPreviewMode type="content")
        articleHtml = articleHtml.replace(/<div\b[^>]*type=["']content["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi, (m, inner) => {
            let content = inner + '</div>';
            content = content.replace(/<h2/i, '<h2 class="text-xl font-bold mb-3 text-amber-900 dark:text-amber-500"');
            content = content.replace(/<p>/gi, '<p class="mb-3">');
            return `<div class="not-prose my-6 p-5 rounded-2xl bg-amber-50 dark:bg-amber-900/10 border-l-4 border-l-amber-500 dark:border-l-amber-600 text-gray-800 dark:text-gray-200 shadow-sm leading-relaxed">${content}</div>`;
        });

        // Box Tin Lien Quan (VCSortableInPreviewMode type="RelatedNewsBox")
        articleHtml = articleHtml.replace(/<div\b[^>]*type=["']RelatedNewsBox["'][^>]*>([\s\S]*?)<\/ul>\s*<\/div>\s*<\/div>/gi, (m, inner) => {
            const liMatches = [...inner.matchAll(/<li\b([^>]*)>/gi)];
            liMatches.forEach(match => {
                const liAttrs = match[1];
                const urlM = liAttrs.match(/data-url=["']([^"']+)["']/i);
                const titleM = liAttrs.match(/data-title=["']([^"']+)["']/i);
                const avatarM = liAttrs.match(/data-avatar=["']([^"']+)["']/i);
                if (urlM && titleM) addItem(urlM[1], titleM[1], avatarM ? avatarM[1] : '', '', true);
            });
            return '';
        });

        // Box detail__related
        const relatedMatch = html.match(/<div\b[^>]*class=["'][^"']*detail__related[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/i);
        if (relatedMatch) {
            const itemRegex = /<article\b[^>]*class=["'][^"']*box-category-item[^"']*["'][^>]*>([\s\S]*?)<\/article>/gi;
            let itemMatch;
            while ((itemMatch = itemRegex.exec(relatedMatch[1])) !== null) {
                const itemHtml = itemMatch[1];
                const linkMatch = itemHtml.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
                if (linkMatch) {
                    const img = (itemHtml.match(/<source\b[^>]*(?:data-src|src)=["']([^"']+)["']/i) || itemHtml.match(/<img\b[^>]*src=["']([^"']+)["']/i) || itemHtml.match(/<video\b[^>]*poster=["']([^"']+)["']/i) || [])[1] || '';
                    addItem(linkMatch[1], (linkMatch[2] || '').replace(/<[^>]+>/g, '').trim() || (itemHtml.match(/title=["']([^"']+)["']/i) || [])[1] || '', img, '');
                }
            }
        }

        // Clean out tuoitre-relatenews leftover tags
        articleHtml = articleHtml.replace(/<ul\b[^>]*class=["'][^"']*tuoitre-relatenews[^"']*["'][^>]*>[\s\S]*?<\/ul>/gi, '');

        // Format Scoreboard
        articleHtml = articleHtml.replace(/<div\b[^>]*class=["'][^"']*box_tiso_all[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi, (m, inner) => {
            const nameAMatch = inner.match(/id=["']lblNameA["'][^>]*>([^<]+)/i) || [];
            const imgAMatch = inner.match(/id=["']imgTeamA["'][^>]*src=["']([^"']+)["']/i) || [];
            const scoreAMatch = inner.match(/id=["']lblScoreA["'][^>]*>([^<]+)/i) || [];
            const nameBMatch = inner.match(/id=["']lblNameB["'][^>]*>([^<]+)/i) || [];
            const imgBMatch = inner.match(/id=["']imgTeamB["'][^>]*src=["']([^"']+)["']/i) || [];
            const scoreBMatch = inner.match(/id=["']lblScoreB["'][^>]*>([^<]+)/i) || [];
            const statusMatch = inner.match(/id=["']lblStatus["'][^>]*>([^<]+)/i) || [];
            
            return `
            <div class="not-prose my-6 max-w-lg mx-auto bg-gray-50 dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div class="bg-blue-600 text-white text-center text-xs font-bold uppercase tracking-widest py-1.5">${statusMatch[1] || 'Trận đấu'}</div>
                <div class="flex items-center justify-between p-4 px-6">
                    <div class="flex flex-col items-center gap-2 flex-1">
                        <img src="${imgAMatch[1] || ''}" class="w-12 h-12 rounded-full object-contain bg-white shadow-sm p-1">
                        <span class="font-bold text-gray-900 dark:text-gray-100 text-sm text-center">${nameAMatch[1] || 'Đội 1'}</span>
                    </div>
                    <div class="flex items-center gap-3 px-4">
                        <span class="text-3xl font-black text-gray-900 dark:text-gray-100">${scoreAMatch[1] || '0'}</span>
                        <span class="text-gray-400 font-medium">-</span>
                        <span class="text-3xl font-black text-gray-900 dark:text-gray-100">${scoreBMatch[1] || '0'}</span>
                    </div>
                    <div class="flex flex-col items-center gap-2 flex-1">
                        <img src="${imgBMatch[1] || ''}" class="w-12 h-12 rounded-full object-contain bg-white shadow-sm p-1">
                        <span class="font-bold text-gray-900 dark:text-gray-100 text-sm text-center">${nameBMatch[1] || 'Đội 2'}</span>
                    </div>
                </div>
            </div>`;
        });

        // Format Timeline Live
        articleHtml = articleHtml.replace(/<div\b[^>]*class=["'][^"']*timeline-row[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi, (m, inner) => {
            const minuteMatch = inner.match(/<span\b[^>]*class=["'][^"']*minute[^"']*["'][^>]*>([^<]+)/i) || [];
            const evtMatch = inner.match(/<div\b[^>]*class=["'][^"']*evt_match[^"']*["'][^>]*>([^<]+)/i) || [];
            const desMatch = inner.match(/<div\b[^>]*class=["'][^"']*timeline-des[^"']*["'][^>]*>([\s\S]*?)(?:$|<\/li>)/i) || [];
            let iconClass = 'bg-blue-500';
            const evtText = evtMatch[1] || '';
            if (evtText.includes('Sút vào')) iconClass = 'bg-green-500';
            if (evtText.includes('Thẻ đỏ')) iconClass = 'bg-red-500';
            if (evtText.includes('Thẻ vàng')) iconClass = 'bg-yellow-500';
            if (evtText.includes('Thay người')) iconClass = 'bg-purple-500';

            return `
            <div class="not-prose flex gap-4 my-4 relative">
                <div class="flex flex-col items-center">
                    <div class="w-10 h-10 rounded-full flex items-center justify-center font-bold text-white text-xs ${iconClass} shadow-md z-10 border-2 border-white dark:border-gray-900">${minuteMatch[1] || ''}</div>
                    <div class="w-0.5 h-full bg-gray-200 dark:bg-gray-700 -mt-2"></div>
                </div>
                <div class="flex-1 pb-6 pt-1">
                    <div class="font-bold text-sm text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">${evtText}</div>
                    <div class="text-gray-900 dark:text-gray-100 text-base leading-relaxed break-words">${desMatch[1] || ''}</div>
                </div>
            </div>`;
        });
        
        // Strip out the wrapper of timeline so it renders cleanly
        articleHtml = articleHtml.replace(/<div\b[^>]*class=["'][^"']*live-zone[^"']*["'][^>]*>[\s\S]*?<div\b[^>]*class=["'][^"']*tuongthuat[^"']*["'][^>]*>/gi, '');
        articleHtml = articleHtml.replace(/<div\b[^>]*id=["']pnlInfomationBeforeMatch["'][^>]*>[\s\S]*?<\/div>/gi, '');
        articleHtml = articleHtml.replace(/<div\b[^>]*id=["']tab-3["'][^>]*>[\s\S]*?<\/div>/gi, '');

        if (result) {
            const authorScript = html.match(/'articleAuthor':\s*'([^']+)'/);
            if (authorScript) {
                result.author = authorScript[1].replace(/\\u([0-9a-fA-F]{4})/g, (m, c) => String.fromCharCode(parseInt(c, 16))).replace(/;/g, ' - ').trim();
            }
            const pubMatch = html.match(/<meta property=["']article:published_time["'] content=["']([^"']+)["']/i);
            if (pubMatch) {
                const dateStr = pubMatch[1].replace(/&#x2B;/i, '+');
                result.timestamp = Date.parse(dateStr);
                result.date = dateStr;
            }
        }

        // Prepend Sapo natively so it has the correct formatting
        const sapoMatch = html.match(/<h2\b[^>]*class=["'][^"']*detail-sapo[^"']*["'][^>]*>([\s\S]*?)<\/h2>/i);
        if (sapoMatch && !articleHtml.includes(sapoMatch[1])) {
            articleHtml = `<p class="font-bold text-xl mb-6 text-gray-900 dark:text-gray-100 leading-relaxed">${sapoMatch[1].trim()}</p>` + articleHtml;
        }

        if (allRelatedItems.length > 0) {
            let itemsHtml = '';
            for (const item of allRelatedItems) {
                itemsHtml += createCardHtml(item.href, item.title, item.img, item.desc);
            }
            articleHtml += createSuggestedHtml('BÀI VIẾT LIÊN QUAN / SỰ KIỆN', itemsHtml);
        }

        return articleHtml;
    }
}
