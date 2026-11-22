// Opt-in live smoke test. Uses only an owned disposable background tab and
// two synthetic prompts; it never touches the reader's production slot leases.
import 'dotenv/config';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Page } from '../../src/browser/opencli-page.js';
import { sendCommand } from '../../node_modules/@jackwener/opencli/dist/src/browser/daemon-client.js';

const source = readFileSync(new URL('../../src/ai/gemini-web.js', import.meta.url), 'utf8').replace(/^export /gm, '');
const { runOnSlot, cleanResponse } = vm.runInNewContext(source + '\n;({runOnSlot, cleanResponse})', {
    process, console, setTimeout, clearTimeout, URL
});
const session = 'rss-gemini-reuse-verification';
const profile = process.env.GEMINI_WEB_PROFILE || process.env.OPENCLI_BROWSER_PROFILE || process.env.OPENCLI_PROFILE;
const page = new Page(session, 120, undefined, 'background', 'browser', 'persistent', profile);
const slot = { id: 'verification', page };
let originalId;
let navigations = 0;
let newChatActions = 0;
const originalGoto = page.goto.bind(page);
page.goto = async (...args) => { navigations++; return originalGoto(...args); };
const originalPressKey = page.pressKey.bind(page);
page.pressKey = async key => {
    if (key === 'Control+Shift+O') newChatActions++;
    return originalPressKey(key);
};
try {
    for (const probe of ['first', 'second']) {
        const text = await runOnSlot(slot, `Reply with exactly this JSON object and no other text: {"probe":"${probe}"}`, { json: true, timeoutMs: 90000 });
        assert.equal(JSON.parse(cleanResponse(text)).probe, probe);
        if (!originalId) originalId = page.getActivePage();
        assert.equal(page.getActivePage(), originalId);
        const tabs = await sendCommand('tabs', { session, surface: 'browser', windowMode: 'background', preferredContextId: profile, op: 'list' });
        assert.equal(tabs.length, 1);
        assert.equal(tabs[0].active, false);
        console.log(`GEMINI_REUSE_PROBE_OK: ${probe}, same inactive tab, fresh response, navigations=${navigations}, newChatActions=${newChatActions}`);
    }
    assert.equal(navigations, 1, 'the second normal job must use New chat without reloading');
    assert.equal(newChatActions, 2);
} finally {
    await page.closeTab();
}
