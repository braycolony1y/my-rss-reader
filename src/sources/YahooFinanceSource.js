import * as cheerio from 'cheerio/slim';

export default class YahooFinanceSource {
    match(host) { return host === 'finance.yahoo.com'; }
    cleanCachedArticleContent(content, result = {}) {
        const $ = cheerio.load(content || '', null, false);
        const author = $('a[href*="/author/"]').first();
        if (author.length) result.author = author.text().trim();
        $('p').each((_, el) => {
            const p = $(el), text = p.text().trim();
            if (p.find('a[href*="/author/"]').length || /^(?:Story Continues|Go deeper with AlphaSpace|At close:|Click here for in-depth analysis|Read the latest financial and business news|Terms and Privacy Policy|Privacy Dashboard)/i.test(text)
                || /^\w{3}, .+\d+ min read$/.test(text)
                || /^\^\w+(?:\s+\^\w+)*$/.test(text)
                || /^[\d.,]+\s+[+-][\d.,]+\s+\([+-][\d.]+%\)$/.test(text)) p.remove();
        });
        $('h4').filter((_, el) => $(el).find('a[href*="/quote/"]').length > 0).remove();
        $('img').each((_, el) => {
            const img = $(el);
            if (/resizefill_(?:h48|w80_h80)|\/author\/|logo/i.test(img.attr('src') || '')) {
                if (img.parent().is('p') && !img.parent().text().trim()) img.parent().remove(); else img.remove();
            }
        });
        if (!result.image || /resizefill_(?:h48|w80_h80)|logo/i.test(result.image)) result.image = $('figure img, img').first().attr('src') || '';
        return $.root().html();
    }
    enhanceArticleResult(result) {
        const updated = { ...result, siteName: 'Yahoo Finance' };
        updated.content = this.cleanCachedArticleContent(result.content, updated);
        return updated;
    }
}
