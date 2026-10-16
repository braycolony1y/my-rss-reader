// Opt-in live smoke test. Uses only an owned disposable background tab and
// two synthetic prompts; it never touches the reader's production slot leases.
import 'dotenv/config';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Page } from '../../src/browser/opencli-page.js';
import { readGeminiWebModeState, selectGeminiWebMode } from '../../src/ai/gemini-web-mode.js';
import { sendCommand } from '../../node_modules/@jackwener/opencli/dist/src/browser/daemon-client.js';

process.env.GEMINI_WEB_URL ||= 'https://gemini.google.com/u/0/app';
const source = readFileSync(new URL('../../src/ai/gemini-web.js', import.meta.url), 'utf8')
    .replace(/^import .+;\r?\n/gm, '').replace(/^export /gm, '');
const { runOnSlot, cleanResponse, temporaryChatState } = vm.runInNewContext(
    source + '\n;({runOnSlot, cleanResponse, temporaryChatState})', {
        process, console, setTimeout, clearTimeout, URL, Buffer,
        readGeminiWebModeState, selectGeminiWebMode
    }
);
const session = 'rss-gemini-reuse-verification';
const profile = process.env.GEMINI_WEB_PROFILE || process.env.OPENCLI_BROWSER_PROFILE || process.env.OPENCLI_PROFILE;
const page = new Page(session, 120, undefined, 'background', 'browser', 'persistent', profile);
const slot = { id: 'verification', page };
let originalId;
let navigations = 0;
let submitted = 0;
const mode = process.env.GEMINI_LIVE_SMOKE_MODE || '3.8';
const originalGoto = page.goto.bind(page);
page.goto = async (...args) => { navigations++; return originalGoto(...args); };

try {
    for (const probe of ['first', 'second']) {
        const text = await runOnSlot(slot, `Reply with exactly this JSON object and no other text: {"probe":"${probe}"}`, { json: true, geminiWebMode: mode, timeoutMs: 120000, onRequest: () => { submitted++; } });
        assert.equal(JSON.parse(cleanResponse(text)).probe, probe);
        if (!originalId) originalId = page.getActivePage();
        assert.equal(page.getActivePage(), originalId);
        const state = await temporaryChatState(page);
        assert.equal(state.activeTemporaryDom, true, 'Response must remain in Temporary Chat');
        const tabs = await sendCommand('tabs', { session, surface: 'browser', windowMode: 'background', preferredContextId: profile, op: 'list' });
        assert.equal(tabs.length, 1);
        assert.equal(tabs[0].active, false);
        console.log(`GEMINI_REUSE_PROBE_OK: ${probe}, same inactive tab, fresh response, navigations=${navigations}, submitted=${submitted}`);
    }
    assert.ok(navigations <= 1, 'the second job must use New chat without reloading');
    assert.equal(submitted, 2, 'Each job must submit once');
    console.log('GEMINI_LIVE_SMOKE_PASS: second Temporary Chat replied in the original tab');
} finally {
    await page.closeTab().catch(error => console.warn('GEMINI_LIVE_CLEANUP_WARNING:', error.message));
}
