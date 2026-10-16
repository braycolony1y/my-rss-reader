import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { createLeaseBoundPageClass } from '../src/browser/opencli-page.js';
import { patchBackgroundTabCreation, patchBackgroundLeaseReuse } from '../ops/maintenance/opencli-background-tabs.mjs';
import { waitForResponse } from '../src/ai/gemini-web.js';

class FakePage {
    _cmdOpts() { return { session: 'fixture', page: this._page }; }
    getActivePage() { return this._page; }
    setActivePage(id) { this._page = id; }
    async goto() { assert.ok(this._page, 'navigation must reuse a resolved lease'); return this._page; }
}

test('first evaluation binds the existing lease so navigation cannot create a duplicate tab', async () => {
    const calls = [];
    const Page = createLeaseBoundPageClass(FakePage, async (action, options) => {
        calls.push({ action, ...options }); return { page: 'existing-target', data: 'https://fixture.test' };
    }, String);
    const page = new Page();
    assert.equal(await page.goto('https://fixture.test/next'), 'existing-target');
    assert.equal(await page.goto('https://fixture.test/again'), 'existing-target');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].action, 'exec');
});

test('stale target rebinds once through the same session and remembers the recovered target', async () => {
    const pages = [];
    const Page = createLeaseBoundPageClass(FakePage, async (_action, options) => {
        pages.push(options.page);
        if (options.page === 'stale') throw Error('Page not found: stale — stale page identity');
        return { page: 'recovered', data: 'answer' };
    }, String);
    const page = new Page(); page.setActivePage('stale');
    assert.equal(await page.evaluate('fixture'), 'answer');
    await page.evaluate('again');
    assert.deepEqual(pages, ['stale', undefined, 'recovered']);
});

test('all bridge tab creation paths preserve background focus and still support explicit foreground mode', async () => {
    const fixture = `const allowed = ["placeholder",
  "Emulation.setDeviceMetricsOverride",];
    [
        chrome.tabs.create({ windowId, url: targetUrl, active: true }),
        chrome.tabs.create({ windowId: scopedWindowId, url: BLANK_PAGE, active: true }),
        chrome.tabs.create({ windowId, url: cmd.url ?? BLANK_PAGE, active: true })
    ]`;
    const patched = patchBackgroundTabCreation(fixture);
    assert.equal(patchBackgroundTabCreation(patched), patched);
    for (const mode of ['background', 'foreground']) {
        const created = [];
        vm.runInNewContext(patched, { chrome: { tabs: { create: options => created.push(options) } },
            windowId: 1, scopedWindowId: 1, targetUrl: 'https://fixture.test', BLANK_PAGE: 'about:blank',
            cmd: {}, leaseKey: 'fixture', getWindowMode: () => mode });
        assert.equal(created.length, 3);
        assert.ok(created.every(tab => tab.active === (mode === 'foreground')));
    }
});

test('complete new JSON is accepted even if Gemini leaves its Stop button visible', async () => {
    let calls = 0;
    const result = await waitForResponse({ evaluate: async () => {
        calls++; return { text: '{"sections":[{"text":"complete"}]}', generating: true, responseFinished: false };
    } }, '', 1000, true);
    assert.equal(JSON.parse(result).sections[0].text, 'complete');
    assert.equal(calls, 1);
});

test('old baseline JSON is never mistaken for this request completing', async () => {
    const old = '{"previous":true}';
    await assert.rejects(waitForResponse({ evaluate: async () => ({ text: old, generating: false, responseFinished: true }) }, old, 1, true), error => {
        assert.equal(error.code, 'GEMINI_WEB_TIMEOUT');
        assert.equal(error.responseMatchesBaseline, true);
        assert.equal(error.responseStarted, false);
        return true;
    });
});

test('a provider error preserves the exact Gemini slot tab for the next request', async () => {
    const source = readFileSync(new URL('../src/ai/gemini-web.js', import.meta.url), 'utf8');
    const start = source.indexOf('async function runOnSlot(');
    const fn = source.slice(start, source.indexOf('\nexport async function closeGeminiWebSlots', start));
    const page = { closeWindow: () => assert.fail('A provider failure must not close its tab') };
    const slot = { id: 1, page };
    const run = vm.runInNewContext(`(${fn})`, {
        console: { warn() {} }, getPage: async () => page,
        resetGeminiJobPage: async () => { throw Object.assign(Error('Temporary provider error'), { code: 'GEMINI_WEB_TIMEOUT' }); }
    });
    await assert.rejects(run(slot, 'fixture', {}), /Temporary provider error/);
    assert.equal(slot.page, page);
});

test('background leases never reuse the active blank tab', async () => {
    const source = `async function reuse() {
  if (initialTabIsAvailable(initialTabId)) { return 'reused'; }
  return 'created';
}
async function container() {
  const startUrl = initialUrl && isSafeNavigationUrl(initialUrl) ? initialUrl : BLANK_PAGE;
}`;
    const patched = patchBackgroundLeaseReuse(source);
    assert.equal(patchBackgroundLeaseReuse(patched), patched);
    for (const mode of ['background', 'foreground']) {
        const reuse = vm.runInNewContext(patched + ';reuse', {
            initialTabId: 1, initialTabIsAvailable: () => true,
            leaseKey: 'fixture', getWindowMode: () => mode,
            chrome: { tabs: { get: async () => ({ active: true }) } }
        });
        assert.equal(await reuse(), mode === 'background' ? 'created' : 'reused');
    }
});

test('each Gemini job uses New chat then Temporary Chat; failure never reloads or submits', async () => {
    const source = readFileSync(new URL('../src/ai/gemini-web.js', import.meta.url), 'utf8');
    const start = source.indexOf('async function resetGeminiJobPage(');
    const fn = source.slice(start, source.indexOf('\n\nasync function runOnSlot', start));

    for (const failedNewChat of [false, true]) {
        const calls = [];
        const reset = vm.runInNewContext('(' + fn + ')', {
            URL,
            GEMINI_WEB_URL: 'https://gemini.google.com/u/1/app',
            returnToGeminiChatHome: async () => {
                calls.push('new-chat');
                if (failedNewChat) {
                    throw Object.assign(Error('no confirmed new chat'), {
                        code: 'GEMINI_WEB_NEW_CHAT_FAILED'
                    });
                }
            },
            waitForGeminiPage: async () => calls.push('ready'),
            resetFreshTemporaryChat: async () => calls.push('temporary-on')
        });
        const page = {
            evaluate: async () => 'https://gemini.google.com/u/1/app',
            cdp: async () => calls.push('emulated'),
            goto: async () => calls.push('reload')
        };
        if (failedNewChat) {
            await assert.rejects(reset(page), error =>
                error.code === 'GEMINI_WEB_NEW_CHAT_FAILED');
            assert.deepEqual(calls, ['emulated', 'new-chat']);
        } else {
            await reset(page);
            assert.deepEqual(calls, ['emulated', 'new-chat', 'temporary-on']);
        }
    }
});

test('outside Gemini, initial navigation is allowed but normal chat reset still uses UI', async () => {
    const source = readFileSync(new URL('../src/ai/gemini-web.js', import.meta.url), 'utf8');
    const start = source.indexOf('async function resetGeminiJobPage(');
    const fn = source.slice(start, source.indexOf('\n\nasync function runOnSlot', start));
    const calls = [];
    const reset = vm.runInNewContext('(' + fn + ')', {
        URL,
        GEMINI_WEB_URL: 'https://gemini.google.com/u/1/app',
        returnToGeminiChatHome: async () => calls.push('new-chat'),
        waitForGeminiPage: async () => calls.push('ready'),
        resetFreshTemporaryChat: async () => calls.push('temporary-on')
    });
    await reset({
        evaluate: async () => 'about:blank',
        cdp: async () => calls.push('emulated'),
        goto: async () => calls.push('initial-navigation')
    });
    assert.deepEqual(calls, [
        'emulated', 'initial-navigation', 'ready', 'new-chat', 'temporary-on'
    ]);
});


test('Temporary Chat reads either mat-icon text or data-mat-icon-name', async () => {
    const source = readFileSync(new URL('../src/ai/gemini-web.js', import.meta.url), 'utf8');
    const start = source.indexOf('async function temporaryChatState(page)');
    assert.ok(start >= 0);
    const fn = source.slice(start, source.indexOf(
        '\n\nasync function waitForTemporaryChatControl', start
    ));
    const readState = vm.runInNewContext('(' + fn + ')');

    for (const iconVariant of ['text', 'attribute']) {
        const iconHtml = iconVariant === 'text'
            ? '<mat-icon>gemini_chat_temp</mat-icon>'
            : '<mat-icon data-mat-icon-name="gemini_chat_temp"></mat-icon>';
        const dom = new JSDOM(
            '<chat-window></chat-window>' +
            '<button aria-label="Temporary chat">' + iconHtml + '</button>',
            { url: 'https://gemini.google.com/u/0/app', runScripts: 'outside-only' }
        );
        const window = dom.window;
        window.HTMLElement.prototype.getBoundingClientRect = () =>
            ({ x: 0, y: 0, width: 80, height: 20 });
        const page = { evaluate: fn => window.eval('(' + fn.toString() + ')()') };

        const inactive = await readState(page);
        assert.equal(inactive.canEnable, true, iconVariant);
        assert.equal(inactive.enabled, false, iconVariant);
        assert.equal(inactive.conversationEmpty, true, iconVariant);

        window.document.querySelector('chat-window')
            .classList.add('is-temporary-chat');
        const icon = window.document.querySelector('mat-icon');
        if (iconVariant === 'text') {
            icon.textContent = 'close';
        } else {
            icon.setAttribute('data-mat-icon-name', 'close');
        }
        const active = await readState(page);
        assert.equal(active.iconName, 'close', iconVariant);
        assert.equal(active.activeTemporaryDom, true, iconVariant);
        assert.equal(active.enabled, true, iconVariant);
        window.close();
    }
});

test('Gemini tab on account /u/0 switches to configured /u/1 before UI reset', async () => {
    const source = readFileSync(new URL('../src/ai/gemini-web.js', import.meta.url), 'utf8');
    const start = source.indexOf('async function resetGeminiJobPage(');
    const fn = source.slice(start, source.indexOf('\n\nasync function runOnSlot', start));
    const calls = [];
    const reset = vm.runInNewContext('(' + fn + ')', {
        URL,
        GEMINI_WEB_URL: 'https://gemini.google.com/u/1/app',
        returnToGeminiChatHome: async () => calls.push('new-chat'),
        waitForGeminiPage: async () => calls.push('ready'),
        resetFreshTemporaryChat: async () => calls.push('temporary-on')
    });
    await reset({
        evaluate: async () => 'https://gemini.google.com/u/0/app',
        cdp: async () => calls.push('emulated'),
        goto: async url => {
            assert.equal(url, 'https://gemini.google.com/u/1/app');
            calls.push('switch-account');
        }
    });
    assert.deepEqual(calls, [
        'emulated', 'switch-account', 'ready', 'new-chat', 'temporary-on'
    ]);
});
