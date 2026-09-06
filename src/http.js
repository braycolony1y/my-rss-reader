import express from 'express';

export function createHttpApp() {
    const app = express();

    let lastHttpActivityAt = Date.now();

    app.use((req, res, next) => {
        lastHttpActivityAt = Date.now();
        next();
    });

    app.use(express.json());

    app.use('/public', express.static('public'));

    app.use('/api', (req, res, next) => {
        if (!req.path.startsWith('/og-image')) {
            res.setHeader('Cache-Control', 'no-cache');
        }
        next();
    });

    function waitForHttpIdle(idleMs = 2500) {
        return new Promise(resolve => {
            const check = () => {
                const remaining = idleMs - (Date.now() - lastHttpActivityAt);
                if (remaining <= 0) {
                    resolve();
                    return;
                }
                setTimeout(check, Math.min(remaining, 500));
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
