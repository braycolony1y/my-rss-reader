export default class UpgradedPointsSource {
    match(hostname) {
        return hostname === 'upgradedpoints.com' || hostname.endsWith('.upgradedpoints.com');
    }

    parseArticleHtmlContent(html, url, result, utils) {
        // extract avatar
        const authorImageMatch = html.match(/<figure class="template-header__author-image">.*?<img.*?src="([^"]+)".*?<\/figure>/i);
        if (authorImageMatch) {
            let avatarUrl = authorImageMatch[1];
            avatarUrl = avatarUrl.replace(/&amp;/g, '&');
            result.authorAvatar = avatarUrl;
        }

        const articleRegex = /<article\b[^>]*>([\s\S]*?)<\/article>/i;
        const match = html.match(articleRegex);
        if (match) {
            let articleHtml = match[1];
            // Remove TOC, author bio, social shares, disclosures, ads
            articleHtml = articleHtml.replace(/<div[^>]*class=["'][^"']*(?:toc|table-of-contents|author-bio|social-share|disclosure|contentAdvertiserDisclosure|top-partner-offers-mobile-dropdown|we-recommend-esi|upgp-display-ad-wrapper)[^"']*["'][^>]*>[\s\S]*?<\/div>/ig, '');
            articleHtml = articleHtml.replace(/<section[^>]*class=["'][^"']*(?:feedback-form|authorInfo|upgp-email-optin|featured-image-credit)[^"']*["'][^>]*>[\s\S]*?<\/section>/ig, '');
            articleHtml = articleHtml.replace(/<details[^>]*class=["'][^"']*(?:top-partner-offers-mobile-dropdown|table-of-contents__container)[^"']*["'][^>]*>[\s\S]*?<\/details>/ig, '');
            
            return articleHtml;
        }
        return null;
    }
}
