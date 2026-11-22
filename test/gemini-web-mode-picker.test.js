import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/ai/gemini-web.js', import.meta.url), 'utf8');
const start = source.indexOf('async function waitForModePicker(');
const fnSource = source.slice(start, source.indexOf('async function openModelMenu'));

function build(page) {
    const providerError = (_p, message, code) => { throw Object.assign(new Error(message), { code }); };
    return vm.runInNewContext(`(${fnSource.trim()})`, {
        Date, POLL_MS: 5, sleep: ms => new Promise(resolve => setTimeout(resolve, ms)), providerError
    });
}

test('mode picker appears after the sidebar is collapsed once', async () => {
    let sidebarOpen = true, closeClicks = 0;
    const page = { evaluate: async fn => {
        const code = fn.toString();
        if (code.includes('bard-mode-menu-button')) return !sidebarOpen;
        if (/close sidebar/i.test(code)) { closeClicks++; sidebarOpen = false; return undefined; }
        return undefined;
    } };
    await build(page)(page, 3000);
    assert.equal(closeClicks, 1);
});

test('already-visible picker returns immediately without touching the sidebar', async () => {
    let closeClicks = 0;
    const page = { evaluate: async fn => {
        if (fn.toString().includes('bard-mode-menu-button')) return true;
        closeClicks++;
    } };
    const started = Date.now();
    await build(page)(page, 3000);
    assert.equal(closeClicks, 0);
    assert.ok(Date.now() - started < 50);
});

test('a genuinely missing picker fails fast with GEMINI_WEB_MODE_PICKER_NOT_FOUND', async () => {
    const page = { evaluate: async () => false };
    const started = Date.now();
    await assert.rejects(build(page)(page, 1600), { code: 'GEMINI_WEB_MODE_PICKER_NOT_FOUND' });
    assert.ok(Date.now() - started < 3000);
});
