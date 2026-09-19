import fs from 'fs/promises';

export function registerPageRoutes({
    app,
} = {}) {
    // ============================================================================
    // CRON SCHEDULER & HTML SERVING
    // ============================================================================

    app.get('/script.js', async (req, res) => {
        try {
            const js = await fs.readFile('./script.js', 'utf8');
            res.setHeader('Content-Type', 'application/javascript');
            res.setHeader('Cache-Control', 'no-cache, must-revalidate');
            res.send(js);
        } catch (e) {
            res.status(500).send('Error loading script');
        }
    });

    app.get('/', async (req, res) => {
        try {
            const html = await fs.readFile('./index.html', 'utf8');
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
