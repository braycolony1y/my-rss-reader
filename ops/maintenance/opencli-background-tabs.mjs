import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function patchBackgroundTabCreation(source) {
    const creations = [
        'chrome.tabs.create({ windowId, url: targetUrl, active: true })',
        'chrome.tabs.create({ windowId: scopedWindowId, url: BLANK_PAGE, active: true })',
        'chrome.tabs.create({ windowId, url: cmd.url ?? BLANK_PAGE, active: true })'
    ];
    for (const original of creations) {
        const patched = original.replace('active: true', 'active: getWindowMode(leaseKey) === "foreground"');
        if (source.includes(patched)) continue;
        if (!source.includes(original)) throw new Error('Unsupported Browser Bridge tab creation; no files changed');
        source = source.replace(original, patched);
    }
    // Let an inactive Gemini tab render as visible without selecting the tab
    // or focusing its browser window. Its UI otherwise stalls in background.
    if (!source.includes('"Emulation.setFocusEmulationEnabled"')) {
        const anchor = '  "Emulation.setDeviceMetricsOverride",';
        if (!source.includes(anchor)) throw new Error('Unsupported Browser Bridge CDP allowlist; no files changed');
        source = source.replace(anchor, '  "Emulation.setFocusEmulationEnabled",\n' + anchor);
    }
    return source;
}

export function patchBackgroundLeaseReuse(source) {
    const old = '  if (initialTabIsAvailable(initialTabId)) {';
    const updated = '  if (initialTabIsAvailable(initialTabId) && (getWindowMode(leaseKey) === "foreground" || !(await chrome.tabs.get(initialTabId)).active)) {';
    if (!source.includes(updated)) {
        if (!source.includes(old)) throw new Error('Unsupported initial-tab reuse; no files changed');
        source = source.replace(old, updated);
    }
    const anchor = '  const startUrl = initialUrl && isSafeNavigationUrl(initialUrl) ? initialUrl : BLANK_PAGE;';
    if (!source.includes('// OPENCLI_BACKGROUND_EXISTING_WINDOW')) {
        if (!source.includes(anchor)) throw new Error('Unsupported container creation; no files changed');
        source = source.replace(anchor, `  // OPENCLI_BACKGROUND_EXISTING_WINDOW
  // Use an existing browser window so creating the container cannot create
  // a selected first tab, and never navigate an active user's blank tab.
  if (mode === "background" && role === "interactive") {
    const windows = await chrome.windows.getAll({ windowTypes: ["normal"] });
    const existing = windows.find(window => window.focused) ?? windows[0];
    if (existing?.id !== undefined) {
      container.windowId = existing.id;
      await persistRuntimeState();
      return { windowId: existing.id, initialTabId: undefined };
    }
  }
` + anchor);
    }
    return source;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const directory = resolve(process.argv[2] || '/home/ubuntu/opencli-extension-1.0.24');
    const file = join(directory, 'dist/background.js');
    const original = readFileSync(file, 'utf8');
    let patched = patchBackgroundLeaseReuse(patchBackgroundTabCreation(original));
    // Closing the selected placeholder implicitly selects another tab. Keep
    // active blanks until they are no longer the user's current tab.
    patched = patched.replace('tab.status !== \'complete\' || tab.pinned)', 'tab.status !== \'complete\' || tab.pinned || tab.active)');
    if (patched !== original) {
        if (!existsSync(file + '.before-background-tabs')) writeFileSync(file + '.before-background-tabs', original);
        writeFileSync(file, patched);
    }
    writeFileSync(join(directory, 'reload-background-tabs.html'), '<!doctype html><title>OpenCLI background tab update</title><script src="reload-background-tabs.js"></script>');
    writeFileSync(join(directory, 'reload-background-tabs.js'), 'setTimeout(() => { window.close(); chrome.runtime.reload(); }, 500);\n');
    console.log('Browser Bridge now honors background mode for all three tab-creation paths. Reload the extension to activate.');
}
