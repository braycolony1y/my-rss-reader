import { gzip, brotliCompress, constants } from 'node:zlib';
import { promisify } from 'node:util';

// The composed shell changes only when its source changes. Share compression
// across concurrent loads and keep a bounded cache of those exact bytes.
export function createShellCompression({ compress = promisify(gzip), maxBytes = 8 * 1024 * 1024,
    maxEntries = 4, minBytes = 16384 } = {}) {
    const cache = new Map();
    const brotli=promisify(brotliCompress);
    let bytes = 0;
    function encoded(body, encoding) {
        const key=encoding+':'+body;
        const hit = cache.get(key);
        if (hit) {
            cache.delete(key); cache.set(key, hit);
            return hit.promise;
        }
        const entry = { bytes: body.length * 2 + Buffer.byteLength(body) + 1024 };
        entry.promise = encoding==='br'?brotli(body,{params:{[constants.BROTLI_PARAM_QUALITY]:4}}):compress(body, { level: 4 });
        if (entry.bytes <= maxBytes) {
            cache.set(key, entry); bytes += entry.bytes;
            while (cache.size > maxEntries || bytes > maxBytes) {
                const [key, oldest] = cache.entries().next().value;
                cache.delete(key); bytes -= oldest.bytes;
            }
            entry.promise.then(buffer => {
                if (cache.get(key) !== entry) return;
                bytes -= entry.bytes;
                entry.bytes = body.length * 2 + buffer.length;
                bytes += entry.bytes;
            }, () => {
                if (cache.get(key) === entry) { cache.delete(key); bytes -= entry.bytes; }
            });
        }
        return entry.promise;
    }
    return (req, res, next) => {
        if (!['GET', 'HEAD'].includes(req.method) || !['/', '/script.js'].includes(req.path)) return next();
        res.vary('Accept-Encoding');
        const accepted=req.acceptsEncodings('br','gzip','identity');
        if (!accepted) return res.status(406).end();
        if (accepted==='identity') return next();
        const identityAllowed=Boolean(req.acceptsEncodings('identity'));
        const encoding=accepted==='br'?'br':'gzip';
        const send = res.send.bind(res);
        res.send = body => {
            if (typeof body !== 'string' || (Buffer.byteLength(body) < minBytes && identityAllowed)
                || res.statusCode < 200 || res.statusCode >= 300 || res.getHeader('Content-Encoding')
                || /no-transform/i.test(res.getHeader('Cache-Control') || '')) return send(body);
            encoded(body,encoding).then(buffer => {
                if (res.destroyed || res.writableEnded) return;
                if (!res.getHeader('Content-Type')) res.type('html');
                res.setHeader('Content-Encoding', encoding);
                send(buffer);
            }, next);
            return res;
        };
        next();
    };
}
