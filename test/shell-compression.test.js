import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync, gunzipSync} from 'node:zlib';
import {createShellCompression} from '../src/middleware/shell-compression.js';

function request(middleware, body, {path = '/script.js', encoding = true, cacheControl = ''} = {}) {
    return new Promise((resolve, reject) => {
        const headers = {'Content-Type': 'application/javascript', 'Cache-Control': cacheControl};
        const res = {statusCode: 200, getHeader: key => headers[key],
            setHeader: (key, value) => {headers[key] = value;}, vary() {},
            send: data => {resolve({headers, data});}, type() {}};
        middleware({method: 'GET', path, acceptsEncodings: () => encoding}, res, error => {
            if (error) reject(error); else res.send(body);
        });
    });
}

test('shell gzip shares concurrent work, reuses exact bodies, and invalidates changed assets', async () => {
    let calls = 0;
    const middleware = createShellCompression({minBytes: 1, compress: async body => {calls++; return gzipSync(body);}});
    const body = 'Source code '.repeat(1000);
    const results = await Promise.all([request(middleware, body), request(middleware, body)]);
    assert.equal(calls, 1);
    assert.equal(results[0].headers['Content-Encoding'], 'gzip');
    assert.equal(gunzipSync(results[0].data).toString(), body);
    await request(middleware, body); assert.equal(calls, 1);
    await request(middleware, body + 'new'); assert.equal(calls, 2);
});

test('shell compression respects negotiation, no-transform, route isolation, and bounded eviction', async () => {
    let calls = 0;
    const middleware = createShellCompression({minBytes: 1, maxEntries: 1,
        compress: async body => {calls++; return gzipSync(body);}});
    const body = 'plain text';
    for (const options of [{encoding: false}, {cacheControl: 'no-transform'}, {path: '/api/events'}]) {
        assert.equal((await request(middleware, body, options)).data, body);
    }
    assert.equal(calls, 0);
    await request(middleware, body); await request(middleware, body + '2'); await request(middleware, body);
    assert.equal(calls, 3);
});
