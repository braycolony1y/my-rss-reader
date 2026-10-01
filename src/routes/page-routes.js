import { createReaderAssetRenderer } from '../ui/reader-assets.js';

export function registerPageRoutes({
    app,
} = {}) {
    const renderer = createReaderAssetRenderer();
    // ============================================================================
    // CRON SCHEDULER & HTML SERVING
    // ============================================================================

    app.get('/script.js', async (req, res) => {
        try {
            const js = await renderer.script();
            res.setHeader('Content-Type', 'application/javascript');
            res.setHeader('Cache-Control', 'no-cache, must-revalidate');
            res.send(js);
        } catch (e) {
            res.status(500).send('Error loading script');
        }
    });

    app.get('/', async (req, res) => {
        try {
            const html = await renderer.html();
            // The document contains critical inline component styles and the
            // versioned asset URLs, so it must revalidate instead of serving a
            // day-old shell after a UI deployment.
            res.setHeader('Cache-Control', 'no-cache, must-revalidate');
            res.send(html);
        } catch (e) {
            res.status(500).send('Please create an index.html file with your frontend code.');
        }
    });

}
