// Opt-in live smoke test. Uses only an owned disposable background tab and
// two synthetic prompts; it never touches the reader's production slot leases.
import 'dotenv/config';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Page } from '../../src/browser/opencli-page.js';
import { readGeminiWebModeState, selectGeminiWebMode } from '../../src/ai/gemini-web-mode.js';
import { sendCommand } from '../../node_modules/@jackwener/opencli/dist/src/browser/daemon-client.js';

// Match the production provider's default account route; override explicitly
// with GEMINI_WEB_URL if the intended signed-in account is different.
process.env.GEMINI_WEB_URL ||= 'https://gemini.google.com/u/1/app';
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
console.log('GEMINI_LIVE_SMOKE_CONFIG', JSON.stringify({
    targetUrl: process.env.GEMINI_WEB_URL, mode,
    profileConfigured: Boolean(profile)
}));
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
} catch (error) {
    console.error('GEMINI_LIVE_SMOKE_FAIL:', error.code || error.name, error.message);
    if (error.code === 'GEMINI_WEB_MODEL_NOT_FOUND' || error.code === 'GEMINI_WEB_MODEL_UPSELL') {
        try {
            // Model picker is normally closed by ensureModel's finally.
            // Reopen it for read-only diagnostics; do not pick an option.
            const diagnostic = await page.evaluate(() => {
                const picker = document.querySelector('[data-test-id="bard-mode-menu-button"]');
                const button = picker?.querySelector('button') || picker;
                if (!button) return { pickerFound: false };
                const expanded = button.getAttribute('aria-expanded') === 'true' ||
                    picker?.getAttribute('aria-expanded') === 'true';
                if (!expanded) button.click();
                return {
                    pickerFound: true,
                    pageUrl: location.href,
                    pickerTag: picker.tagName.toLowerCase(),
                    pickerText: String(picker.innerText || picker.textContent || '')
                        .replace(/\s+/g, ' ').trim().slice(0, 140)
                };
            });
            await new Promise(resolve => setTimeout(resolve, 500));
            const details = await page.evaluate(() => {
                const visible = element => {
                    const style = getComputedStyle(element);
                    const rect = element.getBoundingClientRect();
                    return style.display !== 'none' &&
                        style.visibility !== 'hidden' &&
                        rect.width > 0 && rect.height > 0;
                };
                const roots = [...document.querySelectorAll(
                    '[data-test-id="gem-mode-menu"],gem-menu,.cdk-overlay-pane,[role="menu"]'
                )].filter(visible);
                const items = [...document.querySelectorAll(
                    'gem-menu-item,[role="menuitem"],[role="menuitemradio"],[role="option"],[data-test-id^="bard-mode-option-"]'
                )].filter(item => visible(item) &&
                    roots.some(root => root === item || root.contains(item)));
                return {
                    menuRoots: roots.slice(0, 12).map(root => ({
                        tag: root.tagName.toLowerCase(),
                        testId: root.getAttribute('data-test-id'),
                        role: root.getAttribute('role'),
                        itemCount: items.filter(item => root.contains(item)).length
                    })),
                    options: [...new Set(items)].slice(0, 32).map(item => ({
                        tag: item.tagName.toLowerCase(),
                        id: item.getAttribute('data-test-id'),
                        modeId: item.getAttribute('data-mode-id'),
                        value: item.getAttribute('value'),
                        role: item.getAttribute('role'),
                        label: String(item.querySelector('.label')?.textContent ||
                            item.innerText || item.textContent || '')
                            .replace(/\s+/g, ' ').trim().slice(0, 150),
                        selected: item.classList.contains('selected') ||
                            item.getAttribute('aria-selected') === 'true' ||
                            Boolean(item.querySelector('[aria-label="Selected"]')),
                        disabled: item.getAttribute('aria-disabled') === 'true' ||
                            item.hasAttribute('disabled')
                    }))
                };
            });
            console.log('GEMINI_LIVE_MODEL_DIAGNOSTIC', JSON.stringify({
                ...diagnostic, ...details
            }, null, 2));
        } catch (diagnosticError) {
            console.error('GEMINI_LIVE_DIAGNOSTIC_ERROR:',
                diagnosticError.code || diagnosticError.name,
                diagnosticError.message);
        }
    }
    process.exitCode = 1;
} finally {
    await page.closeTab().catch(error => console.warn('GEMINI_LIVE_CLEANUP_WARNING:', error.message));
}
