import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
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
        compress(body, { level: 4 }).then(buffer => {
            if (res.destroyed || res.writableEnded) return;
            res.setHeader('Content-Encoding', 'gzip');
            send(buffer);
        }, next);
        return res;
    };
    next();
}
