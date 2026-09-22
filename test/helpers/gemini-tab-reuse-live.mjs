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
const originalEvaluate = page.evaluate.bind(page);
let lastActive = null;
page.evaluate = async (...args) => {
    const result = await originalEvaluate(...args);
    const tabs = await sendCommand('tabs', { session, surface: 'browser', windowMode: 'background', preferredContextId: profile, op: 'list' });
    if (tabs[0]?.active !== lastActive) {
        console.log('TAB_ACTIVE_TRANSITION', JSON.stringify({active:tabs[0]?.active,command:String(args[0]).slice(0,180)}));
        lastActive = tabs[0]?.active;
    }
    return result;
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
        console.log(`GEMINI_REUSE_PROBE_OK: ${probe}, same inactive tab, fresh response`);
    }
} finally {
    await page.closeTab();
}
