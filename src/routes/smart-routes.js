import { authMiddleware } from '../middleware/auth.js';

export function registerSmartRoutes({
    app,
    reconcileAllConfiguredSourceFetchMethods,
    smartNews,
    synchronizeConfiguredSourceFetchMethods,
    setManualSyncProgress,
    finishManualSyncProgress,
} = {}) {
    app.get('/api/smart-sources', authMiddleware, async (req, res) => {
        try {
            const { sources } = await reconcileAllConfiguredSourceFetchMethods();
            res.json({ sources });
        } catch (error) {
            res.status(500).json({ sources: [], error: error.message });
        }
    });

    app.post('/api/smart-sources', authMiddleware, async (req, res) => {
        try {
            await smartNews.addSource(req.body || {});
            const synchronized = await reconcileAllConfiguredSourceFetchMethods();
            res.json({ ok: true, ...synchronized });
        } catch (error) {
            res.status(400).json({ ok: false, error: error.message });
        }
    });

    app.delete('/api/smart-sources', authMiddleware, async (req, res) => {
        try {
            const sources = await smartNews.removeSource(req.body?.url);
            res.json({ ok: true, sources });
        } catch (error) {
            res.status(400).json({ ok: false, error: error.message });
        }
    });

    app.patch('/api/smart-sources', authMiddleware, async (req, res) => {
        try {
            if (Array.isArray(req.body?.fetchMethods)) {
                const currentSources = await smartNews.getSourceSettings();
                const targetSource = currentSources.find(source => source.url === req.body?.url);
                if (!targetSource) throw new Error('Smart source not found.');
                const synchronized = await synchronizeConfiguredSourceFetchMethods(
                    targetSource,
                    req.body.fetchMethods
                );
                return res.json({ ok: true, ...synchronized });
            }

            const sources = await smartNews.setSourceEnabled(req.body?.url, req.body?.enabled !== false);
            res.json({ ok: true, sources });
        } catch (error) {
            res.status(400).json({ ok: false, error: error.message });
        }
    });

    app.post('/api/smart-sources/discover', authMiddleware, async (req, res) => {
        try {
            const result = await smartNews.discoverSources(req.body || {});
            res.json({ ok: true, ...result });
        } catch (error) {
            res.status(400).json({ ok: false, error: error.message });
        }
    });

    app.post('/api/smart-sources/reset', authMiddleware, async (req, res) => {
        try {
            await smartNews.resetSources();
            const synchronized = await reconcileAllConfiguredSourceFetchMethods();
            res.json({ ok: true, ...synchronized });
        } catch (error) {
            res.status(500).json({ ok: false, error: error.message });
        }
    });

    app.get('/api/smart-status', authMiddleware, async (req, res) => {
        res.json(await smartNews.getStatus());
    });

    app.get('/api/smart-settings', authMiddleware, async (req, res) => {
        res.json(await smartNews.getSettings());
    });

    app.post('/api/smart-settings', authMiddleware, async (req, res) => {
        try {
            const updated = await smartNews.updateSettings(req.body || {});
            res.json({ ok: true, settings: updated });
        } catch (error) {
            res.status(400).json({ ok: false, error: error.message });
        }
    });

    app.post('/api/smart-sync', authMiddleware, async (req, res) => {
        const requestId = String(req.body?.requestId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
        let targetCategory = req.body && req.body.category ? req.body.category : null;
        setManualSyncProgress(requestId, 'starting', targetCategory ? `Preparing Smart refresh for ${targetCategory}…` : 'Preparing Smart refresh…');
        try {
            const result = await smartNews.sync(progress => {
                setManualSyncProgress(requestId, progress.stage, progress.message, progress);
            }, targetCategory, { forceRebuild: req.body?.forceRebuild === true });
            finishManualSyncProgress(requestId, result.skipped ? 'Smart feed is already up to date.' : 'Smart refresh complete.', {
                failed: result.ok === false
            });
            res.json(result);
        } catch (error) {
            finishManualSyncProgress(requestId, 'Smart refresh failed.', { failed: true, error: error.message });
            res.status(500).json({ ok: false, error: error.message });
        }
    });

}
