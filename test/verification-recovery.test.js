import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createSourceCooldown} from '../src/articles/source-cooldown.js';
import {createReaderVerificationRecovery} from '../src/articles/verification-recovery.js';

const url = 'https://publisher.example.test/article';
const article = {title: 'A verified article', content: '<p>' + 'Actual publisher article. '.repeat(30) + '</p>'};
const blocked = () => {throw Error('Publisher verification HTTP 403');};

async function fixture() {
    let clock = 1000;
    const values = {};
    const db = {get: async key => structuredClone(values[key]), put: async (key, raw) => {values[key] = JSON.parse(raw);}};
    const cooldown = createSourceCooldown({now: () => clock, baseMs: 100});
    await cooldown.initialize(db);
    return {cooldown, db, values, advance: ms => {clock += ms;}};
}

test('accepted live reader recovery resets only its publisher and persists the reset across restart', async () => {
    const f = await fixture();
    await assert.rejects(f.cooldown.run(url, blocked));
    await assert.rejects(f.cooldown.run('https://other.test/a', blocked));
    const session = await createReaderVerificationRecovery(url, {cooldown: f.cooldown, context: {lane: 'p0'}});
    assert.equal(await session.accept(article), true);
    assert.equal(f.cooldown.get(url).remainingMs, 0); assert.equal(f.cooldown.get(url).strikes, undefined);
    assert.equal(f.cooldown.get('https://other.test/b').remainingMs, 100);
    const restarted = createSourceCooldown({now: () => 1000}); await restarted.initialize(f.db);
    assert.equal(restarted.get(url).remainingMs, 0);
    await assert.rejects(f.cooldown.run(url, blocked));
    assert.equal(f.cooldown.get(url).strikes, 1); assert.equal(f.cooldown.get(url).remainingMs, 100);
});

test('cached, partial, deleted, challenge and failed results cannot clear a publisher pause', async () => {
    const f = await fixture(); await assert.rejects(f.cooldown.run(url, blocked));
    const session = await createReaderVerificationRecovery(url, {cooldown: f.cooldown, context: {lane: 'p0'}});
    for (const extra of [{cached: true}, {partialContent: true}, {sourceDeleted: true}, {error: 'failed'},
        {content: 'Only a fragment'}, {title: 'Security Verification', content: '<h1>Just a moment</h1>'}]) {
        assert.equal(await session.accept({...article, ...extra}), false);
        assert.equal(f.cooldown.get(url).remainingMs, 100);
    }
    const background = await createReaderVerificationRecovery(url, {cooldown: f.cooldown, context: {lane: 'p3'}});
    assert.equal(await background.accept(article), false);
});

test('a late successful reader cannot erase a newer publisher verification incident', async () => {
    const f = await fixture(); await assert.rejects(f.cooldown.run(url, blocked));
    const session = await createReaderVerificationRecovery(url, {cooldown: f.cooldown, context: {lane: 'p0'}});
    f.advance(101); await assert.rejects(f.cooldown.run(url, blocked));
    assert.equal(await session.accept(article), false);
    assert.equal(f.cooldown.get(url).strikes, 2); assert.equal(f.cooldown.get(url).remainingMs, 200);
});

test('a fresh reader attempt observes a pause recorded after its article request began', async () => {
    const f = await fixture(), context = {lane: 'p0'};
    const session = await createReaderVerificationRecovery(url, {cooldown: f.cooldown, context});
    // A concurrent request hits verification before this reader's successful attempt.
    await assert.rejects(f.cooldown.run(url, blocked));
    let prompts = 0;
    context.onVerification = () => {prompts++;};
    const result = await f.cooldown.run(url, () => article, context);
    assert.equal(await session.accept(result), true);
    assert.equal(prompts, 0);
    assert.equal(f.cooldown.get(url).strikes, undefined);
    assert.equal(await f.cooldown.run(url, () => 'background resumed'), 'background resumed');
    const restarted = createSourceCooldown({now: () => 1000}); await restarted.initialize(f.db);
    assert.equal(restarted.get(url).strikes, undefined);
});

test('a verification incident recorded after a reader attempt starts survives its late success', async () => {
    const f = await fixture(), context = {lane: 'p0'};
    const session = await createReaderVerificationRecovery(url, {cooldown: f.cooldown, context});
    let finish, started;
    const admitted = new Promise(resolve => {started = resolve;});
    const reading = f.cooldown.run(url, () => new Promise(resolve => {finish = resolve; started();}), context);
    await admitted;
    await assert.rejects(f.cooldown.run(url, blocked));
    finish(article);
    assert.equal(await session.accept(await reading), false);
    assert.equal(f.cooldown.get(url).strikes, 1);
    assert.equal(f.cooldown.get(url).remainingMs, 100);
});

test('verification solved during the same reader attempt can reset its newly observed incident', async () => {
    const f = await fixture();
    const session = await createReaderVerificationRecovery(url, {cooldown: f.cooldown, context: {lane: 'p0'}});
    session.track(f.cooldown.record(url, Error('HTTP 403')));
    assert.equal(await session.accept(article), true);
    assert.equal(f.cooldown.get(url).remainingMs, 0);
});

test('verification Retry explicitly bypasses the server cache', () => {
    const context = {window: {}};
    vm.runInNewContext(readFileSync(new URL('../public/js/article/verification-notice.js', import.meta.url), 'utf8'), context);
    let options;
    context.window.ReaderPublisherVerification.retry({overlayArticle: {link: url}, articleContentCache: new Map(),
        articleReaderUrl: article => article.link, openArticleOverlay: (article, value) => {options = value;}});
    assert.equal(options.bypassCache, true);
});

test('a failed reset cannot disappear from storage when another publisher resets concurrently', async () => {
    const f = await fixture(), other = 'https://other.test/article';
    await assert.rejects(f.cooldown.run(url, blocked)); await assert.rejects(f.cooldown.run(other, blocked));
    const first = await createReaderVerificationRecovery(url, {cooldown: f.cooldown, context: {lane: 'p0'}});
    const second = await createReaderVerificationRecovery(other, {cooldown: f.cooldown, context: {lane: 'p0'}});
    const put = f.db.put;
    let fail, entered;
    const writing = new Promise(resolve => {entered = resolve;});
    let writes = 0;
    f.db.put = async (...args) => {
        if (++writes === 1) {entered(); await new Promise((resolve, reject) => {fail = reject;});}
        return put(...args);
    };
    const a = first.accept(article); await writing;
    const b = second.accept(article);
    fail(Error('disk failed'));
    assert.equal(await a, false); assert.equal(await b, true);
    const restarted = createSourceCooldown({now: () => 1000}); await restarted.initialize(f.db);
    assert.equal(restarted.get(url).remainingMs, 100);
    assert.equal(restarted.get(other).remainingMs, 0);
});
