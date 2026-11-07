import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { installDiagnosticMode } from './diagnostic-mode.mjs';
import { startUsageFixture } from './usage-fixture.mjs';
import { diagnosticRequestAllowed } from './diagnostic-guard.mjs';

export async function startDiagnosticServer({ enabled = false, upstream = '', port = 0 } = {}) {
    if (!enabled) throw Error('Development diagnostics are disabled. Start this separate loopback server with --enable. Production files are never modified.');
    const live = upstream ? new URL(upstream) : null;
    if (live && (live.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(live.hostname)))
        throw Error('The live backend must be an HTTP loopback address on this server');
    const proxyRequests = new Set();
    let boundPort = port;
    const instance = await startUsageFixture({ port,
        transformHtml(html) {
            const script = `(${installDiagnosticMode.toString()})(${JSON.stringify({ developmentOnly: true, fixture: !live })});`;
            return html.replace('<head>', `<head><script>${script.replace(/<\/script/gi, '<\\/script')}</script>`);
        },
        beforeRequest(req, res, url) {
            if (!diagnosticRequestAllowed(req, boundPort)) {
                res.writeHead(403, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Diagnostic server requires its own loopback origin' }));
                return true;
            }
            if (url.pathname === '/__flicker/status') {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ developmentOnly: true, data: live ? 'live backend' : 'fixture',
                    productionFilesModified: false }));
                return true;
            }
            if (!live || !url.pathname.startsWith('/api/')) return false;
            // Stream SSE and ordinary API responses unchanged; no extra polling.
            // Live mode is explicit because normal app actions can write state.
            const target = new URL(url.pathname + url.search, live);
            const headers = { ...req.headers, host: live.host };
            delete headers.connection;
            const outgoing = http.request(target, { method: req.method, headers }, incoming => {
                res.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(res);
            });
            proxyRequests.add(outgoing);
            outgoing.on('close', () => proxyRequests.delete(outgoing));
            outgoing.on('error', error => {
                if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' });
                if (!res.writableEnded) res.end(JSON.stringify({ error: 'Diagnostic backend unavailable', code: error.code }));
            });
            req.on('aborted', () => outgoing.destroy());
            res.on('close', () => outgoing.destroy());
            req.pipe(outgoing);
            return true;
        }
    });
    boundPort = Number(new URL(instance.url).port);
    return { ...instance, close() { for (const request of proxyRequests) request.destroy(); instance.close(); } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const args = process.argv.slice(2);
    if (args.includes('--help')) console.log('node tools/experiments/modal-reliability/diagnostic-server.mjs --enable [--port 4317] [--live http://127.0.0.1:3000]');
    else {
        const allowed = new Set(['--enable', '--port', '--live']);
        const options = {};
        for (let i = 0; i < args.length; i++) {
            if (!allowed.has(args[i])) throw Error('Unknown diagnostic server option: ' + args[i]);
            if (args[i] === '--enable') options.enabled = true;
            else {
                const option = args[i], value = args[++i];
                if (!value || value.startsWith('--')) throw Error('Missing value for ' + option);
                if (option === '--port') options.port = Number(value);
                else options.upstream = value;
            }
        }
        if (options.port !== undefined && (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535)) throw Error('Invalid development port');
        const server = await startDiagnosticServer(options);
        console.log(`Development-only diagnostics: ${server.url}/?flicker=baseline`);
        console.log(options.upstream ? 'LIVE backend: ordinary app actions retain their normal effects. No production source files changed.' : 'Fixture data only; no live providers or production data.');
        console.log('Stop with Ctrl+C. Remove the query/reload for baseline; no production restart is needed.');
        const close = () => { server.close(); process.exit(0); };
        process.once('SIGINT', close); process.once('SIGTERM', close);
    }
}
