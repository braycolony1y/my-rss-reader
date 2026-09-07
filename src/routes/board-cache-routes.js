import { meaningfulVersions } from '../board/thread-model.js';
import { renderArchive, archivePage } from '../board/presentation.js';
import { authMiddleware } from '../middleware/auth.js';
export function registerBoardCacheRoutes({ app, boardCache }) {
    app.get('/api/article-content', authMiddleware, async (req, res, next) => {
        if (!req.query.url) return next();
        try {
            const record = await boardCache.archive(req.query.url);
            if (!record || (!Object.keys(record.posts).length && !record.legacy_snapshots?.length)) return next();
            const page = archivePage(record, req.query.url);
            res.json({ url: page.url, title: record.title, content: renderArchive(page.record), cached: true,
                archive: true, active_caching: record.active_caching, sync_status: record.sync_status,
                last_successful_sync_at: record.last_successful_sync_at, sync_error: record.sync_error, pagination: page.pagination });
        } catch (e) { next(e); }
    });
    app.get('/api/board-cache', authMiddleware, async (req, res) => {
        res.set('Cache-Control', 'no-store');
        res.json(await boardCache.status());
    });
    app.post('/api/board-cache/folder', authMiddleware, async (req, res) => {
        try { res.json(await boardCache.setFolder(req.body.article, req.body.folder)); }
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
