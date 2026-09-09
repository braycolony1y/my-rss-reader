import test from 'node:test';
import assert from 'node:assert/strict';
import { createArticleReaders } from '../src/articles/readers.js';

test('simultaneous publisher reads share one request and subsequent reads fetch fresh content', async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
        calls++;
        await new Promise(resolve => setTimeout(resolve, 10));
        return new Response('<html>Publisher content</html>');
    };
    try {
        const readers = createArticleReaders({ BROWSER_HEADERS: {} });
        const results = await Promise.all(Array.from({length:3}, () => readers.fetchArticleHtmlByStrategy('direct', 'https://example.com/story')));
        assert.equal(calls, 1);
        assert.equal(new Set(results).size, 1);
        await readers.fetchArticleHtmlByStrategy('direct', 'https://example.com/story');
        assert.equal(calls, 2);
    } finally { globalThis.fetch = original; }
});

test('publisher timeout remains active while reading the body', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async (_, {signal}) => ({
        status:200, ok:true,
        text:() => new Promise((resolve,reject) => signal.addEventListener('abort', () => reject(new Error('body aborted')), {once:true}))
    });
    try {
        const readers = createArticleReaders({ BROWSER_HEADERS: {} });
        await assert.rejects(readers.fetchWithCookies('https://example.com/slow', 20), /body aborted/);
    } finally { globalThis.fetch = original; }
});
