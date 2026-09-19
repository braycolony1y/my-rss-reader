import { authMiddleware } from './middleware/auth.js';

const clients = new Set();
let sequence = 0;

function encodeEvent(type, data = {}) {
    sequence += 1;
    return `id: ${sequence}\nevent: ${type}\ndata: ${JSON.stringify({ ...data, emittedAt: Date.now() })}\n\n`;
}

export function publishAppEvent(type, data = {}) {
    const payload = encodeEvent(type, data);
    for (const client of [...clients]) {
        try {
            client.write(payload);
        } catch {
            clients.delete(client);
        }
    }
}

export function registerEventRoutes({ app } = {}) {
    if (!app) throw new Error('registerEventRoutes requires app');

    app.get('/api/events', authMiddleware, (req, res) => {
        res.status(200);
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders?.();

        clients.add(res);
        res.write('retry: 5000\n');
        res.write(encodeEvent('ready', { connected: true }));

        const heartbeat = setInterval(() => {
            try {
                res.write(`: heartbeat ${Date.now()}\n\n`);
            } catch {
                clearInterval(heartbeat);
                clients.delete(res);
            }
        }, 25000);

        const cleanup = () => {
            clearInterval(heartbeat);
            clients.delete(res);
        };

        req.on('close', cleanup);
        req.on('aborted', cleanup);
    });
}
