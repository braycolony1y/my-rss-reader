import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createReaderAssetRenderer } from '../../../src/ui/reader-assets.js';
import { createFixtureApi } from './fixtures.js';

export async function startFixtureServer({ baseline = '', transformResponse = value => value, imageDelayMs = 0,
    transformHtml = value => value, beforeRequest = () => false, port = 0 } = {}) {
    const root = fileURLToPath(new URL('../../../', import.meta.url));
    const renderer = createReaderAssetRenderer();
    const api = createFixtureApi();
    const requests = [];
    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://localhost');
        requests.push(url.pathname + url.search);
        try {
            if (await beforeRequest(req, res, url)) return;
            if (url.pathname === '/api/events') {
                res.writeHead(200, { 'Content-Type': 'text/event-stream' });
                res.write(': fixture connection\n\n');
                return;
            }
            if (url.pathname.startsWith('/api/')) {
                if (url.pathname === '/api/og-image' && imageDelayMs) {
                    await new Promise(resolve => setTimeout(resolve, imageDelayMs));
                    res.setHeader('Content-Type', 'image/jpeg');
                    res.end(await readFile(path.join(root, 'public/default.jpg')));
                    return;
                }
                let body = '';
                for await (const chunk of req) body += chunk;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(transformResponse(api(url, body ? JSON.parse(body) : {}), url)));
                return;
            }
            if (url.pathname === '/') {
                res.setHeader('Content-Type', 'text/html');
                res.end(transformHtml(baseline ? await readFile(path.join(baseline, 'rendered.html'), 'utf8') : await renderer.html(), url));
                return;
            }
            if (url.pathname === '/script.js') {
                res.setHeader('Content-Type', 'text/javascript');
                res.end(baseline ? await readFile(path.join(baseline, 'rendered.js')) : await renderer.script());
                return;
            }
            if (url.pathname.startsWith('/public/')) {
                const target = path.resolve(root, '.' + url.pathname);
                if (!target.startsWith(path.join(root, 'public') + path.sep)) throw new Error('Invalid fixture path');
                const types = { '.css': 'text/css', '.js': 'text/javascript', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };
                res.setHeader('Content-Type', types[path.extname(target)] || 'application/octet-stream');
                res.end(await readFile(baseline && url.pathname === '/public/styles.css' ? path.join(baseline, 'styles.css') : target));
                return;
            }
            res.writeHead(404).end();
        } catch (error) { res.writeHead(500).end(error.message); }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    return {
        url: `http://127.0.0.1:${server.address().port}`, requests,
        close: () => { server.closeAllConnections(); server.close(); }
    };
}
