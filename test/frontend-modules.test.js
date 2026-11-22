import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createReaderAssetRenderer, READER_ASSET_PATHS } from '../src/ui/reader-assets.js';
import { composeReaderPartials } from '../src/ui/reader-partials.js';

test('feature composition preserves lazy getters, proxy this, and per-instance state', () => {
    const context = vm.createContext({});
    vm.runInContext(readFileSync(new URL('../public/js/app/component.js', import.meta.url), 'utf8'), context);
    const result = vm.runInContext(`(() => {
        let getterCalls = 0;
        const factories = [
            () => ({ get total() { getterCalls++; return this.count + this.offset; }, increment() { this.count++; } }),
            () => ({ count: 1, offset: 2, pending: new Set() })
        ];
        const app = ReaderComponent.compose(factories);
        const untouched = getterCalls;
        const proxy = new Proxy(app, { get(target, key, receiver) { return key === 'offset' ? 10 : Reflect.get(target, key, receiver); } });
        proxy.increment();
        const total = proxy.total;
        app.pending.add('first-instance');
        return { untouched, total, count: app.count, isolated: ReaderComponent.compose(factories).pending.size === 0,
            isGetter: typeof Object.getOwnPropertyDescriptor(app, 'total').get === 'function' };
    })()`, context);
    assert.deepEqual(JSON.parse(JSON.stringify(result)), { untouched: 0, total: 12, count: 2, isolated: true, isGetter: true });
});

test('reader partials preserve literal content and reject missing or circular includes', () => {
    assert.equal(composeReaderPartials('before<!-- reader:include outer -->\nafter', {
        outer: '<section><!-- reader:include inner -->\n</section>', inner: '$& $1 <div x-data="{ open: true }"></div>'
    }), 'before<section>$& $1 <div x-data="{ open: true }"></div></section>after');
    assert.throws(() => composeReaderPartials('<!-- reader:include missing -->', {}), /Missing reader partial/);
    assert.throws(() => composeReaderPartials('<!-- reader:include a -->', { a: '<!-- reader:include b -->', b: '<!-- reader:include a -->' }), /Circular reader partial/);
});

test('composed production shell retains synchronous Alpine startup and a single card template', async () => {
    const renderer = createReaderAssetRenderer();
    const html = await renderer.html();
    assert.doesNotMatch(html, /<!-- reader:(?:include|article-card-component)/);
    assert.equal((html.match(/x-data="rssApp\(\)"/g) || []).length, 1);
    assert.equal((html.match(/<template x-for="\(article, articleIndex\) in displayedArticles"/g) || []).length, 1);
    assert.match(html, /<script src="\/script\.js\?v=[^"]+"><\/script>/);
    assert.ok(html.indexOf('/api/data?') < html.indexOf('alpinejs/collapse'));
    assert.ok(html.indexOf('dataset.imageFocus') < html.indexOf('src="/public/image-focus.js'));
    new vm.Script(await renderer.script());
    for (const filename of READER_ASSET_PATHS.clientModules) new vm.Script(readFileSync(filename, 'utf8'), { filename });
});

test('head prefetch preserves authentication, saved-state guards and Smart route parameters', () => {
    const html = readFileSync(READER_ASSET_PATHS.index, 'utf8');
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
    assert.equal(scripts.length, 2, 'only the two timing-critical bootstraps remain inline');
    const run = ({ auth = true, saved = false, hash = '', width = 390, disabledStorage = false } = {}) => {
        const requests = [];
        const storage = { getItem(key) { if (disabledStorage) throw new Error('Storage disabled'); return key === 'rssAppState' && saved ? '{}' : null; } };
        vm.runInNewContext(scripts[1], {
            document: { cookie: auth ? 'auth=true' : '' }, window: { innerWidth: width }, location: { hash },
            localStorage: storage, sessionStorage: storage, URLSearchParams,
            fetch: (url, options) => { requests.push({ url, credentials: options.credentials }); return Promise.resolve({ ok: true }); }
        });
        return requests;
    };
    const request = run()[0];
    assert.equal(request.credentials, 'same-origin');
    assert.equal(new URL(request.url, 'http://fixture').searchParams.get('limit'), '15');
    assert.equal(new URL(request.url, 'http://fixture').searchParams.get('filterValue'), 'news_vietnam');
    const global = new URL(run({ hash: '#smart/tech_world?article=encoded', width: 1440 })[0].url, 'http://fixture').searchParams;
    assert.equal(global.get('filterValue'), 'tech_global');
    assert.equal(global.get('smartRegion'), 'global');
    assert.equal(global.get('smartMode'), 'top');
    assert.equal(global.get('limit'), '40');
    for (const options of [{ auth: false }, { saved: true }, { hash: '#category/Forum' }, { disabledStorage: true }]) assert.deepEqual(run(options), []);
});
