import { gzip, brotliCompress, constants } from 'node:zlib';
import { promisify } from 'node:util';
import { performance } from 'node:perf_hooks';
const compress = promisify(gzip), brotli = promisify(brotliCompress);

// Compress JSON send() responses, including pre-serialized Smart lists.
// Streaming SSE and media never pass through this body interceptor. The existing handler still owns status, validators and cache policy.
export function listJsonCompression(req, res, next) {
    res.vary('Accept-Encoding');
    const accepted=req.acceptsEncodings('br','gzip','identity');
    if (!accepted) return res.status(406).end();
    if (accepted==='identity') return next();
    const identityAllowed=Boolean(req.acceptsEncodings('identity'));
    const encoding=accepted==='br'?'br':'gzip';
    const send = res.send.bind(res);
    res.send = body => {
        if (typeof body !== 'string' || !/application\/json/i.test(res.getHeader('Content-Type') || '')
            || (Buffer.byteLength(body) < 16384 && identityAllowed) || res.getHeader('Content-Encoding')
            || /no-transform/i.test(res.getHeader('Cache-Control') || '')) return send(body);
        const started=performance.now();
        const loop=performance.eventLoopUtilization();
        (encoding==='br'?brotli(body,{params:{[constants.BROTLI_PARAM_QUALITY]:4}}):compress(body, { level: 4 })).then(buffer => {
            if (res.destroyed || res.writableEnded) return;
            res.setHeader('Content-Encoding', encoding);
            const elapsed=performance.eventLoopUtilization(loop);
            res.setHeader('Server-Timing', [res.getHeader('Server-Timing'), `compression;dur=${(performance.now()-started).toFixed(3)}`, `compression-loop-active;dur=${elapsed.active.toFixed(3)}`, `compression-loop-idle;dur=${elapsed.idle.toFixed(3)}`].filter(Boolean).join(', '));
            send(buffer);
        }, next);
        return res;
    };
    next();
}
