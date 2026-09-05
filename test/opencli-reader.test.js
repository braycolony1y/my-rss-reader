import test from 'node:test';
import assert from 'node:assert/strict';
import { isActiveArticleSession, isVerificationPage, readWithHumanVerification } from '../src/opencli-reader.js';

const blocked = { title: 'Verifying the device', contentHtml: '<p>The requested content will be available after verification.</p>' };
const article = { title: 'Report', contentHtml: '<p>A complete report.</p>' };

test('only a live session for the exact article may wait for verification', () => {
    const session = { url: 'https://example.com/a', lastSeen: 1000 };
    assert.equal(isActiveArticleSession(session, session.url, 2000), true);
    assert.equal(isActiveArticleSession(session, 'https://example.com/b', 2000), false);
    assert.equal(isActiveArticleSession(undefined, session.url, 2000), false);
    assert.equal(isActiveArticleSession(session, session.url, 4001), false);
    assert.equal(isVerificationPage(article), false);
    assert.equal(isVerificationPage(blocked), true);
    assert.equal(isVerificationPage({ contentHtml: '<p>Verification</p>', diagnostics: { frames: [{ src: 'https://geo.captcha-delivery.com/captcha/' }] } }), true);
});

function fakePage(results) {
    return {
        closed: false, focused: false,
        async evaluate() { return results.shift() || blocked; },
        async cdp() { this.focused = true; },
        async wait() { assert.equal(this.closed, false); },
        async closeWindow() { this.closed = true; }
    };
}
const read = page => page.evaluate('extract');

test('background CAPTCHA closes normally without a manual prompt', async () => {
    const page = fakePage([blocked]);
    await assert.rejects(readWithHumanVerification(read, page, {}, () => false), /verification blocked/);
    assert.equal(page.closed, true);
    assert.equal(page.focused, false);
});

test('the active article waits for manual verification and then resumes', async () => {
    const page = fakePage([blocked, blocked, article]);
    let prompts = 0;
    const result = await readWithHumanVerification(read, page, {}, () => {
        assert.equal(page.closed, false);
        prompts++;
        return true;
    });
    assert.equal(result, article);
    assert.equal(prompts, 2);
    assert.equal(page.focused, true);
    assert.equal(page.closed, true);
});

test('leaving the article during verification closes its browser tab', async () => {
    const page = fakePage([blocked]);
    let checks = 0;
    await assert.rejects(readWithHumanVerification(read, page, {}, () => ++checks === 1), /verification blocked/);
    assert.equal(page.closed, true);
    assert.equal(checks, 2);
});

test('ordinary successful reads close without consulting manual verification', async () => {
    const page = fakePage([article]);
    assert.equal(await readWithHumanVerification(read, page, {}, () => assert.fail('Unexpected CAPTCHA prompt')), article);
    assert.equal(page.closed, true);
});
