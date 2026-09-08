import { authMiddleware } from '../middleware/auth.js';
export function registerPdfRoutes({ app, pdf }) {
    app.post('/api/article-pdf', authMiddleware, async (req, res) => {
        try {
            const { url, title, feedUrl, totalPages } = req.body || {};
            const parsed = new URL(url);
            if (!['http:', 'https:'].includes(parsed.protocol)) return res.status(400).json({ error: 'An article URL is required.' });
            const job = await pdf.start({ url: parsed.href, title, feedUrl, totalPages });
            res.status(job.status === 'ready' ? 200 : 202).json(job);
        } catch (error) { res.status(400).json({ error: error.message }); }
    });
    app.get('/api/article-pdf/:id', authMiddleware, async (req, res) => {
        try { const job = await pdf.status(req.params.id); res.status(job ? 200 : 404).json(job || { error: 'This PDF has expired or does not exist.' }); }
        catch (error) { res.status(500).json({ error: error.message }); }
    });
    app.get('/api/article-pdf/:id/download', authMiddleware, async (req, res) => {
        try {
            const result = await pdf.download(req.params.id);
            if (!result) return res.status(409).json({ error: 'The complete PDF is not ready yet.' });
            res.set('Cache-Control', 'private, no-store');
            res.download(result.file, result.name);
        } catch (error) { if (!res.headersSent) res.status(404).json({ error: 'This PDF is no longer available.' }); }
    });
    app.delete('/api/article-pdf/:id', authMiddleware, async (req, res) => {
        try { const job = await pdf.cancel(req.params.id); res.status(job ? 200 : 404).json(job || { error: 'PDF job not found.' }); }
        catch (error) { res.status(500).json({ error: error.message }); }
    });
}
