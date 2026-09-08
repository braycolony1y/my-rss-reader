import { meaningfulVersions } from '../board/thread-model.js';
import { authMiddleware } from '../middleware/auth.js';
export function registerBoardCacheRoutes({ app, boardCache }) {
    app.get('/api/article-content', authMiddleware, async (req, res, next) => {
        if (!req.query.url) return next();
        try {
            // Retained history must not replace live content after leaving Cache.
            if (!await boardCache.managed(req.query.url)) return next();
            res.set('Cache-Control', 'no-store');
            const payload = await boardCache.articlePage(req.query.url);
            if (!payload) return next();
            res.json(payload);
        } catch (e) { next(e); }
    });
    app.get('/api/board-cache', authMiddleware, async (req, res) => {
        res.set('Cache-Control', 'no-store');
        res.json(await boardCache.status());
    });
    app.post('/api/board-cache/folder', authMiddleware, async (req, res) => {
        try { res.json(await boardCache.setFolder(req.body.article, req.body.folder, { compact: req.body.compact === true })); }
        catch (e) { res.status(400).json({ error: e.message }); }
    });
    app.put('/api/board-cache/rules', authMiddleware, async (req, res) => {
        try { res.json({ rules: await boardCache.saveRules(req.body.rules) }); }
        catch (e) { res.status(400).json({ error: e.message }); }
    });
    app.post('/api/board-cache/active', authMiddleware, async (req, res) => {
        if (typeof req.body.active !== 'boolean') return res.status(400).json({ error: 'Active must be On or Off' });
        try { await boardCache.setActive(req.body.url, req.body.active); res.json({ success: true }); }
        catch (e) { res.status(400).json({ error: e.message }); }
    });
    app.get('/api/board-cache/archive', authMiddleware, async (req, res) => {
        res.set('Cache-Control', 'no-store');
        try {
            const archive = await boardCache.archive(req.query.url);
            if (archive) for (const post of Object.values(archive.posts)) post.versions = meaningfulVersions(post, archive.url);
            res.json({ archive });
        }
        catch (e) { res.status(400).json({ error: e.message }); }
    });
}
