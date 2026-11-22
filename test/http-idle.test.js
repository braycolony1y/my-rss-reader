import test from 'node:test';
import assert from 'node:assert/strict';
import { createHttpApp } from '../src/http.js';

test('continuous foreground traffic cannot starve background refresh forever', async () => {
    const http = createHttpApp();
    const start = Date.now();
    const timer = setInterval(() => { http.lastHttpActivityAt = Date.now(); }, 5);
    try {
        await http.waitForHttpIdle(80, 100);
        assert.ok(Date.now() - start >= 80);
        assert.ok(Date.now() - start < 1000);
    } finally { clearInterval(timer); }
});

test('Smart status polling does not reset the foreground idle clock', () => {
    const http = createHttpApp();
    const middleware = http.app.router.stack[0].handle;
    http.lastHttpActivityAt = 1;
    middleware({ method:'GET',path:'/api/smart-status' }, {}, () => {});
    assert.equal(http.lastHttpActivityAt,1);
    middleware({ method:'GET',path:'/api/data' }, {}, () => {});
    assert.ok(http.lastHttpActivityAt>1);
});
