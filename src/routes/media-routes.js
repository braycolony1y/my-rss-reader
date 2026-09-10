import { safeHttpUrl, publisherIcon } from '../utils/article-utils.js';
import { authMiddleware } from '../middleware/auth.js';
import { discardResponseBody } from '../fetch-response.js';

export function registerMediaRoutes({
    app,
    CF_PROXY_BASE,
    BROWSER_HEADERS,
    getBestImage,
    getLastKnownCachedArticleImage,
} = {}) {
    app.get('/api/cached-card-image', authMiddleware, async (req, res) => {
        const url = safeHttpUrl(req.query.url);
        if (!url) return res.status(400).send('Invalid URL');
        const image = safeHttpUrl(await getLastKnownCachedArticleImage(url));
        res.setHeader('Cache-Control', 'private, max-age=60');
        res.redirect(image || publisherIcon(url));
    });

    app.get('/api/proxy-image', authMiddleware, async (req, res) => {
        const targetUrl = req.query.url;
        if (!targetUrl) return res.status(400).send('Missing URL');
        try {
            const fetchUrl = CF_PROXY_BASE + encodeURIComponent(targetUrl);
            const imgRes = await fetch(fetchUrl, {
                headers: {
                    ...BROWSER_HEADERS,
                    'Referer': new URL(targetUrl).origin + '/',
                    'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
                }
            });
            if (imgRes.ok) {
                const buffer = await imgRes.arrayBuffer();
                res.setHeader('Content-Type', imgRes.headers.get('Content-Type') || 'image/jpeg');
                res.setHeader('Cache-Control', 'public, max-age=86400');
                return res.send(Buffer.from(buffer));
            }
            await discardResponseBody(imgRes);
        } catch (e) {
            console.error(`[PROXY CRASH] ${e.message}`);
        }
        res.status(404).send('Not found');
    });

    app.get('/api/x-profile-image', authMiddleware, async (req, res) => {
        const handle = String(req.query.handle || '').replace(/^@/, '').trim();
        if (!/^[a-z0-9_]{1,32}$/i.test(handle)) return res.status(400).send('Invalid X handle');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        try {
            const imageResponse = await fetch(`https://unavatar.io/x/${encodeURIComponent(handle)}`, {
                headers: {
                    ...BROWSER_HEADERS,
                    Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
                },
                signal: controller.signal
            });
            const contentType = imageResponse.headers.get('content-type') || '';
            if (!imageResponse.ok || !contentType.toLowerCase().startsWith('image/')) {
                await discardResponseBody(imageResponse);
                return res.status(404).send('Profile image not found');
            }
            const buffer = Buffer.from(await imageResponse.arrayBuffer());
            res.setHeader('Content-Type', contentType);
            res.setHeader('Cache-Control', 'private, max-age=86400, stale-while-revalidate=604800');
            return res.send(buffer);
        } catch (error) {
            return res.status(404).send('Profile image not found');
        } finally {
            clearTimeout(timeout);
        }
    });

    app.get('/api/og-image', authMiddleware, async (req, res) => {
        const targetUrl = req.query.url;
        const rssFallback = req.query.rss;
        if (!targetUrl) return res.status(400).send('Missing URL');
        try {
            const scrapeUrl = targetUrl.replace(/\/unread\/?$/, '');
            const foundImg = await getBestImage(scrapeUrl, async (u, opts = {}) => fetch(u, { headers: BROWSER_HEADERS, ...opts }), rssFallback);
            if (foundImg) {
                res.setHeader('Cache-Control', 'private, max-age=86400, stale-while-revalidate=604800');
                if (foundImg.includes('dantri.com.vn') || foundImg.includes('baodautu.vn')) {
                    return res.redirect(301, `/api/proxy-image?url=${encodeURIComponent(foundImg)}`);
                }
                return res.redirect(301, foundImg);
            }
            res.status(404).send('Image not found');
        } catch (e) {
            res.status(500).send('Error');
        }
    });

}
