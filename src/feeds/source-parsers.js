import { decodeHTMLEntities } from '../../feed-parsers.js';

function parseMorningstar(html) {
    console.log(`\n[MORNINGSTAR DEBUG] Extracting data from Nuxt payload...`);
    const items = [];
    let matchCount = 0;

    try {
        const rawScript = html.split('window.__NUXT__=')[1];
        if (!rawScript) {
            throw new Error('Could not find window.__NUXT__ script.');
        }

        const scriptText = rawScript.split('</script>')[0].trim();
        const code = `
            const window = {};
            window.__NUXT__ = ${scriptText.endsWith(';') ? scriptText.slice(0, -1) : scriptText};
            return window.__NUXT__;
        `;

        const nuxtData = new Function(code)();
        const stories = nuxtData?.data?.[0]?.stories || [];

        console.log(`[MORNINGSTAR DEBUG] Found ${stories.length} stories in Nuxt data.`);

        for (const story of stories) {
            if (matchCount >= 20) break;

            const title = story.headline?.title || 'No Title';
            const link = `https://www.morningstar.com${story.canonicalURL || ''}`;
            const pubDate = story.displayDate || new Date().toISOString();

            let imageUrl = null;
            if (story.promoItems?.image?.variations?.['16:9']?.srcset) {
                const srcset = story.promoItems.image.variations['16:9'].srcset;
                const match = srcset.match(/([^,\s]+)\s+960w/);
                if (match) imageUrl = match[1];
            }
            if (!imageUrl && story.promoItems?.image?.src) {
                imageUrl = story.promoItems.image.src;
            }

            const contentSnippet = story.headline?.subtitle || story.headline?.metaDescription || title;

            items.push({
                title: decodeHTMLEntities(title),
                link: link,
                pubDate: pubDate,
                content: contentSnippet,
                imageUrl: imageUrl,
                customPublisher: 'Morningstar',
                customIcon: 'https://www.morningstar.com/favicon.ico'
            });
            matchCount++;
        }
    } catch (e) {
        console.error(`[MORNINGSTAR DEBUG] 🔴 Error parsing Nuxt data: ${e.message}`);
    }

    if (items.length === 0) {
        console.log(`[MORNINGSTAR DEBUG] Falling back to HTML regex extraction...`);
        const articleRegex = /<a\s+href=["']([^"']+)["'][^>]*mdc-basic-feed-item__mdc[^>]*>([\s\S]{0,5000}?)<\/a>/gi;
        let match;
        while ((match = articleRegex.exec(html)) !== null && matchCount < 20) {
            let link = match[1];
            if (!link.startsWith('http')) {
                let domain = 'https://www.morningstar.com';
                if (html.includes('https://global.morningstar.com')) {
                    domain = 'https://global.morningstar.com';
                }
                link = domain + (link.startsWith('/') ? '' : '/') + link;
            }

            const contentBlock = match[2];
            const titleMatch = contentBlock.match(/<h[234][^>]*>.{0,200}?<span itemprop=["']name["']>([\s\S]{0,500}?)<\/span>/i) || contentBlock.match(/<h[234][^>]*>([\s\S]{0,500}?)<\/h[234]>/i);
            let title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : 'No Title';

            const imgMatch = contentBlock.match(/<img[^>]*src=["']([^"']+)["'][^>]*mdc-basic-feed-item__image__mdc/i) || contentBlock.match(/<img[^>]*src=["']([^"']+)["']/i);
            let imageUrl = imgMatch ? imgMatch[1] : null;

            const bodyMatch = contentBlock.match(/<div[^>]*class=["'][^"']*mdc-basic-feed-item__body__mdc[^"']*["'][^>]*>([\s\S]{0,2000}?)<\/div>/i);
            let body = bodyMatch ? bodyMatch[1].replace(/<[^>]+>/g, '').trim() : decodeHTMLEntities(title);
            if (!body) body = decodeHTMLEntities(title);

            items.push({
                title: decodeHTMLEntities(title),
                link: link,
                pubDate: new Date().toISOString(),
                content: body,
                imageUrl: imageUrl,
                customPublisher: 'Morningstar',
                customIcon: 'https://www.morningstar.com/favicon.ico'
            });
            matchCount++;
        }
        console.log(`[MORNINGSTAR DEBUG] Found ${items.length} stories via HTML regex.`);
    }

    if (items.length === 0) {
        console.log(`[MORNINGSTAR DEBUG] Falling back to Markdown / General link extraction...`);
        const seenLinks = new Set();

        // Match Markdown links: e.g., [![Img](imgUrl) ### Title...](linkUrl) or [Title...](linkUrl)
        const mdRegex = /\[(?:!\[[^\]]*\]\(([^)]+)\)\s*)?(?:#{1,4}\s*)?([^\]]{1,250})\]\((https?:\/\/(?:www\.|global\.)?morningstar\.[^)]+|\/[^)]+)\)/gi;
        let match;
        while ((match = mdRegex.exec(html)) !== null && items.length < 20) {
            let imageUrl = match[1] || null;
            let rawText = match[2].trim();
            let link = match[3].split('?')[0].split('#')[0];
            if (link.startsWith('/')) link = 'https://www.morningstar.com' + link;

            if (link.includes('/indexes/') || link.includes('/login') || link.includes('/search') || link.includes('/tools/') || link.includes('/portfolio') || link.includes('/topics/')) continue;
            if (rawText.length < 15 || rawText === 'Morningstar' || rawText === 'View All') continue;
            if (seenLinks.has(link)) continue;
            seenLinks.add(link);

            let title = rawText.replace(/^#{1,4}\s*/, '').trim();
            let contentSnippet = title;
            if (title.length > 110) {
                const splitIndex = title.search(/[\.\?!]\s|[A-Z][a-z]+ \d{1,2}, \d{4}/);
                if (splitIndex > 20 && splitIndex < 110) {
                    contentSnippet = title;
                    title = title.substring(0, splitIndex + 1).trim();
                } else {
                    title = title.substring(0, 100) + '...';
                }
            }

            items.push({
                title: decodeHTMLEntities(title),
                link: link,
                pubDate: new Date().toISOString(),
                content: decodeHTMLEntities(contentSnippet),
                imageUrl: imageUrl,
                customPublisher: 'Morningstar',
                customIcon: 'https://www.morningstar.com/favicon.ico'
            });
        }

        // If Markdown didn't yield items, match general HTML article links
        if (items.length === 0) {
            const htmlLinkRegex = /<a[^>]+href=["'](https?:\/\/(?:www\.|global\.)?morningstar\.[^"']+|\/[^"']+)["'][^>]*>([\s\S]{0,2000}?)<\/a>/gi;
            while ((match = htmlLinkRegex.exec(html)) !== null && items.length < 20) {
                let link = match[1].split('?')[0].split('#')[0];
                if (link.startsWith('/')) link = 'https://www.morningstar.com' + link;

                if (link.includes('/indexes/') || link.includes('/login') || link.includes('/search') || link.includes('/tools/') || link.includes('/portfolio') || link.includes('/topics/')) continue;
                if (seenLinks.has(link)) continue;

                const innerHtml = match[2];
                const textOnly = innerHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                if (textOnly.length < 15 || textOnly === 'Morningstar' || textOnly === 'View All') continue;
                seenLinks.add(link);

                let imageUrl = null;
                const imgMatch = innerHtml.match(/<img[^>]+src=["']([^"']+)["']/i);
                if (imgMatch) imageUrl = imgMatch[1];

                items.push({
                    title: decodeHTMLEntities(textOnly.length > 110 ? textOnly.substring(0, 100) + '...' : textOnly),
                    link: link,
                    pubDate: new Date().toISOString(),
                    content: decodeHTMLEntities(textOnly),
                    imageUrl: imageUrl,
                    customPublisher: 'Morningstar',
                    customIcon: 'https://www.morningstar.com/favicon.ico'
                });
            }
        }
        console.log(`[MORNINGSTAR DEBUG] Found ${items.length} stories via Markdown/General link extraction.`);
    }

    return { items, feedTitle: 'Morningstar' };
}

function parseK(str) {
    if (!str) return 0;
    str = str.toString().toUpperCase().replace(/,/g, '');
    if (str.endsWith('K')) return parseFloat(str) * 1000;
    if (str.endsWith('M')) return parseFloat(str) * 1000000;
    return parseInt(str) || 0;
}

function parseUOBVN(html) {
    const items = [];
    try {
        const cardRegex = /<div class="card [^>]*>[\s\S]{0,1000}?<img[^>]*class="[^"]*card-img-top[^"]*"[^>]*src=["']([^"']+)["'][^>]*>[\s\S]{0,1000}?<h4 class="card-title[^>]*>([\s\S]{0,500}?)<\/h4>[\s\S]{0,1000}?<p class="paragraph">([\s\S]{0,2000}?)<\/p>[\s\S]{0,1000}?<a href=["']([^"']+)["'][^>]*class="dtm-button"/gi;
        let match;
        while ((match = cardRegex.exec(html)) !== null) {
            let imageUrl = match[1];
            if (imageUrl.startsWith('/')) imageUrl = 'https://www.uob.com.vn' + imageUrl;
            let title = match[2].trim();
            let content = match[3].trim();
            let link = match[4];
            if (link.startsWith('/')) link = 'https://www.uob.com.vn' + link;
            let pubDate = new Date().toISOString();

            let dateMatch = title.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})/i);
            if (dateMatch) {
                try { pubDate = new Date(`${dateMatch[1]} 1, ${dateMatch[2]}`).toISOString(); } catch(e) {}
            } else {
                dateMatch = title.match(/(1H|2H|Q1|Q2|Q3|Q4)\s+(\d{4})/i);
                if (dateMatch) {
                    try {
                        let month = 1;
                        let q = dateMatch[1].toUpperCase();
                        if (q === '2H' || q === 'Q3') month = 7;
                        else if (q === 'Q2') month = 4;
                        else if (q === 'Q4') month = 10;
                        pubDate = new Date(`${dateMatch[2]}-${month.toString().padStart(2, '0')}-01`).toISOString();
                    } catch(e) {}
                }
            }

            items.push({
                title: decodeHTMLEntities(title),
                link: link,
                pubDate: pubDate,
                content: decodeHTMLEntities(content),
                imageUrl: imageUrl,
                customPublisher: 'UOB VN Privilege',
                customIcon: 'https://icons.duckduckgo.com/ip3/uob.com.vn.ico'
            });
        }
    } catch (e) {
        console.error(`[UOB VN] Error parsing HTML: ${e.message}`);
    }

    const uniqueItems = [];
    const seenLinks = new Set();
    for (const item of items) {
        if (!seenLinks.has(item.link)) {
            seenLinks.add(item.link);
            uniqueItems.push(item);
        }
    }

    uniqueItems.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());
    return { items: uniqueItems.slice(0, 20), feedTitle: 'UOB Vietnam Market Insights' };
}

function parseUOB(csvString) {
    const items = [];
    try {
        let rows = [];
        let cur = '';
        let inQuote = false;
        const processRow = () => {
            if (rows.length >= 5) {
                let dateStr = rows[0].replace(/^"|"$/g, '').trim();
                let country = rows[1].replace(/^"|"$/g, '').trim();
                let url = rows[2].replace(/^"|"$/g, '').trim();
                let title = rows[3].replace(/^"|"$/g, '').trim();
                let desc = rows[4].replace(/^"|"$/g, '').trim();
                if (country.toLowerCase() === 'vietnam') {
                    let link = url.startsWith('/') ? 'https://www.uobgroup.com' + url : url;
                    let pubDate = new Date().toISOString();
                    try {
                        let d = new Date(dateStr);
                        if (!isNaN(d.getTime())) pubDate = d.toISOString();
                    } catch(e) {}
                    items.push({
                        title: decodeHTMLEntities(title),
                        link: link,
                        pubDate: pubDate,
                        content: decodeHTMLEntities(desc),
                        imageUrl: 'https://www.uobgroup.com/web-resources/common/images/uob-logo.jpg',
                        customPublisher: 'UOB Research',
                        customIcon: 'https://icons.duckduckgo.com/ip3/uobgroup.com.ico'
                    });
                }
            }
            rows = [];
            cur = '';
        };

        for (let i = 0; i < csvString.length; i++) {
            let c = csvString[i];
            if (c === '"') {
                inQuote = !inQuote;
            } else if (c === ',' && !inQuote) {
                rows.push(cur);
                cur = '';
            } else if (c === '\n' && !inQuote) {
                rows.push(cur);
                processRow();
            } else if (c !== '\r') {
                cur += c;
            }
        }
        if (cur || rows.length > 0) {
            rows.push(cur);
            processRow();
        }
    } catch (e) {
        console.error(`[UOB] Error parsing CSV: ${e.message}`);
    }
    items.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());
    return { items: items.slice(0, 20), feedTitle: 'UOB Research' };
}

function parseTechcombank(jsonString) {
    const items = [];
    try {
        const json = JSON.parse(jsonString);
        const docs = json?.data?.listViewDocumentFragmentList?.items || [];
        for (const doc of docs) {
            let title = doc.categoryTitle?.plaintext || doc.documentTitle?.plaintext || 'Techcombank Report';
            let link = doc.documentPath?._publishUrl || doc.externalDocumentPath || '';
            if (link && link.startsWith('/')) link = 'https://techcombank.com' + link;
            if (!link) continue;

            items.push({
                title: decodeHTMLEntities(title),
                link: link,
                pubDate: doc.date ? new Date(doc.date).toISOString() : new Date().toISOString(),
                content: `Category: ${doc.category || 'N/A'}<br>Title: ${title}`,
                imageUrl: 'https://techcombank.com/content/dam/techcombank/public-site/seo/techcombank-default-thumbnail.jpg',
                customPublisher: 'Techcombank Research',
                customIcon: 'https://icons.duckduckgo.com/ip3/techcombank.com.ico'
            });
        }

        items.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());
    } catch (e) {
        console.error(`[TECHCOMBANK] Error parsing JSON: ${e.message}`);
    }
    return { items: items.slice(0, 20), feedTitle: 'Techcombank Research' };
}

function parseBaoMoi(html) {
    const items = [];
    const seenLinks = new Set();
    let count = 0;
    let matchCount = 0;

    const articleRegex = /"title":"([^"\\]*(?:\\.[^"\\]*)*)".{0,1000}?"redirectUrl":"(\/[^"]+\.epi[^"]*)".{0,1000}?"thumb":"(https:\/\/[^"]+)"/gi;

    let match;
    while ((match = articleRegex.exec(html)) !== null) {
        matchCount++;
        if (count >= 20) break;

        try {
            let rawTitle = match[1];
            let title = rawTitle;
            try {
                title = JSON.parse(`"${rawTitle}"`);
            } catch (e) { }

            let link = match[2];
            link = link.split('#')[0];
            if (link.startsWith('/')) {
                link = 'https://baomoi.com' + link;
            }

            let imageUrl = match[3];

            if (!seenLinks.has(link)) {
                seenLinks.add(link);
                items.push({
                    title: decodeHTMLEntities(title),
                    link: link,
                    pubDate: new Date().toISOString(),
                    content: title,
                    imageUrl: imageUrl
                });
                count++;
            }
        } catch (err) { continue; }
    }
    return { items, feedTitle: 'Báo Mới' };
}

export { parseK, parseBaoMoi, parseMorningstar, parseTechcombank, parseUOB, parseUOBVN };
