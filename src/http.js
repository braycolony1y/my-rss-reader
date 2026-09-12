import express from 'express';

export function createHttpApp() {
    const app = express();

    let lastHttpActivityAt = Date.now();

    app.use((req, res, next) => {
        // Status polling is background traffic; it must not indefinitely
        // postpone the very refresh the browser is waiting for.
        const statusPoll = req.method === 'GET' && /^\/api\/(?:smart-status|sync-status|sync-progress|gemini-key-status|user-states|article-content-progress|summary\/voz\/status)$/.test(req.path);
        if (!statusPoll) lastHttpActivityAt = Date.now();
        next();
    });

    app.use(express.json());
    // Body-parser errors occur before API routes; keep them machine-readable.
    app.use((error, req, res, next) => {
        if (!req.path.startsWith('/api/')) return next(error);
        if (error.type === 'entity.too.large') return res.status(413).json({error:'The request is too large. Reload the page and try again.'});
        if (error.type === 'entity.parse.failed') return res.status(400).json({error:'Invalid JSON request.'});
        next(error);
    });

    app.use('/public', express.static('public'));

    app.use('/api', (req, res, next) => {
        if (!req.path.startsWith('/og-image')) {
            res.setHeader('Cache-Control', 'no-cache');
        }
        next();
    });

    function waitForHttpIdle(idleMs = 2500, maxWaitMs = 30000) {
        const deadline = Date.now() + maxWaitMs;
        return new Promise(resolve => {
            const check = () => {
                const remaining = idleMs - (Date.now() - lastHttpActivityAt);
                if (remaining <= 0 || Date.now() >= deadline) {
                    resolve();
                    return;
                }
                setTimeout(check, Math.min(remaining, deadline - Date.now(), 500));
            };
            check();
        });
    }

    function gcAndLogMemory(label) {
        if (global.gc && Date.now() - lastHttpActivityAt >= 2500) {
            global.gc();
            const mem = process.memoryUsage();
            console.log(`[GC] ${label}: RSS=${(mem.rss / 1024 / 1024).toFixed(0)}MB, Heap=${(mem.heapUsed / 1024 / 1024).toFixed(0)}MB/${(mem.heapTotal / 1024 / 1024).toFixed(0)}MB`);
        } else if (global.gc) {
            console.log(`[GC] ${label}: skipped while HTTP requests are active.`);
        }
    }

    return {
        waitForHttpIdle,
        gcAndLogMemory,
        app,
        get lastHttpActivityAt() { return lastHttpActivityAt; },
        set lastHttpActivityAt(value) { lastHttpActivityAt = value; }
    };
}
