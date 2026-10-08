import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { performance } from 'node:perf_hooks';
const compress = promisify(gzip);

// Compress only the measured list response, including pre-serialized Smart
// lists. The existing handler still owns status, validators and cache policy.
export function listJsonCompression(req, res, next) {
    res.vary('Accept-Encoding');
    if (!req.acceptsEncodings('gzip') || req.method === 'HEAD') return next();
    const send = res.send.bind(res);
    res.send = body => {
        if (typeof body !== 'string' || !/application\/json/i.test(res.getHeader('Content-Type') || '')
            || Buffer.byteLength(body) < 16384 || res.getHeader('Content-Encoding')
            || /no-transform/i.test(res.getHeader('Cache-Control') || '')) return send(body);
        const started=performance.now();
        const loop=performance.eventLoopUtilization();
        compress(body, { level: 4 }).then(buffer => {
            if (res.destroyed || res.writableEnded) return;
            res.setHeader('Content-Encoding', 'gzip');
            const elapsed=performance.eventLoopUtilization(loop);
            res.setHeader('Server-Timing', [res.getHeader('Server-Timing'), `compression;dur=${(performance.now()-started).toFixed(3)}`, `compression-loop-active;dur=${elapsed.active.toFixed(3)}`, `compression-loop-idle;dur=${elapsed.idle.toFixed(3)}`].filter(Boolean).join(', '));
            send(buffer);
        }, next);
        return res;
    };
    next();
}
