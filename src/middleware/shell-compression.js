import { gzip } from 'node:zlib';
import { promisify } from 'node:util';

// The composed shell changes only when its source changes. Share compression
// across concurrent loads and keep a bounded cache of those exact bytes.
export function createShellCompression({ compress = promisify(gzip), maxBytes = 4 * 1024 * 1024,
    maxEntries = 4, minBytes = 16384 } = {}) {
    const cache = new Map();
    let bytes = 0;
    function encoded(body) {
        const hit = cache.get(body);
        if (hit) {
            cache.delete(body); cache.set(body, hit);
            return hit.promise;
        }
        const entry = { bytes: body.length * 2 + Buffer.byteLength(body) + 1024 };
        entry.promise = compress(body, { level: 4 });
        if (entry.bytes <= maxBytes) {
            cache.set(body, entry); bytes += entry.bytes;
            while (cache.size > maxEntries || bytes > maxBytes) {
                const [key, oldest] = cache.entries().next().value;
                cache.delete(key); bytes -= oldest.bytes;
            }
            entry.promise.then(buffer => {
                if (cache.get(body) !== entry) return;
                bytes -= entry.bytes;
                entry.bytes = body.length * 2 + buffer.length;
                bytes += entry.bytes;
            }, () => {
                if (cache.get(body) === entry) { cache.delete(body); bytes -= entry.bytes; }
            });
        }
        return entry.promise;
    }
    return (req, res, next) => {
        if (!['GET', 'HEAD'].includes(req.method) || !['/', '/script.js'].includes(req.path)) return next();
        res.vary('Accept-Encoding');
        if (!req.acceptsEncodings('gzip')) return next();
        const send = res.send.bind(res);
        res.send = body => {
            if (typeof body !== 'string' || Buffer.byteLength(body) < minBytes
                || res.statusCode < 200 || res.statusCode >= 300 || res.getHeader('Content-Encoding')
                || /no-transform/i.test(res.getHeader('Cache-Control') || '')) return send(body);
            encoded(body).then(buffer => {
                if (res.destroyed || res.writableEnded) return;
                if (!res.getHeader('Content-Type')) res.type('html');
                res.setHeader('Content-Encoding', 'gzip');
                send(buffer);
            }, next);
            return res;
        };
        next();
    };
}
