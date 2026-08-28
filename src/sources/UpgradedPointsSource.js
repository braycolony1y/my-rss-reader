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

        let articleHtml = utils.extractBalancedElementByClass(html, 'articleContent');
        if (articleHtml) {
            // Remove TOC, author bio, social shares, disclosures, ads
            const removeClasses = [
                'toc', 'table-of-contents', 'author-bio', 'social-share', 'disclosure', 
                'contentAdvertiserDisclosure', 'top-partner-offers-mobile-dropdown', 
                'we-recommend-esi', 'upgp-display-ad-wrapper', 'feedback-form', 
                'authorInfo', 'upgp-email-optin', 'featured-image-credit', 
                'we-recommend__disclosure', 'weRecommendContent', 'pulseContent', 
                'footerContent', 'table-of-contents__container'
            ];
            
            for (const cls of removeClasses) {
                while (true) {
                    const el = utils.extractBalancedElementByClass(articleHtml, cls);
                    if (el) {
                        articleHtml = articleHtml.replace(el, '');
                    } else {
                        break;
                    }
                }
            }
            
            // Also remove asides
            articleHtml = articleHtml.replace(/<aside\b[^>]*>[\s\S]*?<\/aside>/ig, '');
            
            return articleHtml;
        }
        return null;
    }
}
