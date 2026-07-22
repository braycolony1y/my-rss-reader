const fs = require('fs');

const vozCode = fs.readFileSync('src/sources/VozSource.js', 'utf8');

const methodStr = `
    async getBestImage(targetUrl, fetchFn, rssFallback, utils) {
        let html = '';
        let ok = false;
        try {
            let directHtml = await utils.fetchWithCookies(targetUrl, 6000);
            if (directHtml && !directHtml.includes('Just a moment')) {
                html = directHtml;
                ok = true;
            }
        } catch (e) { }

        if (!ok) {
            let fetchUrl = utils.CF_PROXY_BASE + encodeURIComponent(targetUrl);
            const res = await fetchFn(fetchUrl);
            if (!res.ok) {
                if (rssFallback && !utils.isInvalidImage(rssFallback)) return rssFallback;
                return null;
            }
            html = await res.text();
        }
        let scopeHtml = html;

        if (rssFallback && rssFallback.includes('dantri.com.vn')) rssFallback = null;
        const postMatch = html.match(/<article[^>]*message--post[^>]*>[\\s\\S]*?<div class="bbWrapper">([\\s\\S]*?)<\\/div>\\s*<div class="js-selectToQuoteEnd">/i) || html.match(/<div class="bbWrapper">([\\s\\S]*?)<\\/div>\\s*<div class="js-selectToQuoteEnd">/i);
        if (postMatch) scopeHtml = postMatch[1];

        const extLinks = scopeHtml.match(/<a[^>]+href=["'](https?:\\/\\/[^"']+)["'][^>]*>[\\s\\S]*?<\\/a>/ig) || [];

        for (let linkTag of extLinks) {
            if (linkTag.includes('theNEXTvoz') || linkTag.includes('VOZVNApp')) continue;

            let extMatch = linkTag.match(/href=["'](https?:\\/\\/[^"']+)["']/i);
            if (extMatch && extMatch[1]) {
                let extUrl = extMatch[1];
                extUrl = extUrl.replace(/^https?:\\/\\/amp\\./i, 'https://').replace(/\\/amp\\/?$/i, '');

                if (!extUrl.includes('voz.vn') && !extUrl.match(/\\.(jpg|jpeg|png|gif|webp)$/i)) {
                    try {
                        let extFetchUrl = utils.CF_PROXY_BASE + encodeURIComponent(extUrl);
                        let extRes = await fetchFn(extFetchUrl);
                        let extHtml = '';

                        let img = null;
                        if (extRes.ok) {
                            extHtml = await extRes.text();
                            img = utils.extractImageFromHtml(extHtml, extUrl);
                        }

                        if (!img) {
                            let fallbackUrl = \`https://api.allorigins.win/raw?url=\${encodeURIComponent(extUrl)}\`;
                            let fallbackRes = await fetchFn(fallbackUrl);
                            if (fallbackRes.ok) {
                                extHtml = await fallbackRes.text();
                                img = utils.extractImageFromHtml(extHtml, extUrl);
                            }
                        }

                        if (img) {
                            return img.startsWith('/') ? new URL(img, extUrl).href : img;
                        }
                    } catch (e) { }
                    continue;
                } else if (extUrl.match(/\\.(jpg|jpeg|png|gif|webp)$/i)) {
                    return extUrl;
                }
            }
        }
        if (rssFallback && !utils.isInvalidImage(rssFallback)) return rssFallback;
        return null;
    }
`;

const newVozCode = vozCode.replace(/export default class VozSource \{/, 'export default class VozSource {\n' + methodStr);
fs.writeFileSync('src/sources/VozSource.js', newVozCode);
console.log("Added getBestImage to VozSource.js");
