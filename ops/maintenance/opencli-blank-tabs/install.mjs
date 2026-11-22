import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function patchBackground(source, guard) {
  if (source.includes('// OPENCLI_REMOVE_OWNED_TABS_V1')) {
    const guardStart = source.indexOf('// Runs inside the OpenCLI extension, after its lease registry has recovered.');
    if (guardStart < 0) throw new Error('Patched extension is missing its cleanup guard');
    return source.slice(0, guardStart) + guard;
  }
  const start = source.indexOf('      const hasOtherOwnedLease =', source.indexOf('async function releaseLease('));
  const end = source.indexOf('\n    } else {\n      console.log(`[opencli] Released legacy owned window lease', start);
  if (start < 0 || end < 0) throw new Error('Unsupported OpenCLI releaseLease implementation; no files changed');
  source = source.slice(0, start) + `      // OPENCLI_REMOVE_OWNED_TABS_V1
      // Closing an owned tab must remove it, including the final tab in a container.
      // Replacing it with an active blank page leaks placeholders and steals focus.
      await safeDetach(tabId);
      evictTab(tabId);
      try {
        await chrome.tabs.remove(tabId);
      } catch (error) {
        // If it still exists, preserve the lease so cleanup can retry.
        const remaining = await chrome.tabs.get(tabId).catch(() => null);
        if (remaining) throw error;
      }
      console.log(\x60[opencli] Removed owned tab lease \x24{tabId} (\x24{reason})\x60);` + source.slice(end);
  source = source.replace('async function releaseLease(leaseKey, reason = "released") {',
    'async function releaseLease(leaseKey, reason = "released") {\n  return withLeaseMutation(() => releaseLeaseUnlocked(leaseKey, reason));\n}\nasync function releaseLeaseUnlocked(leaseKey, reason) {');
  const commandHook = '      case "exec":\n        return await handleExec(cmd, leaseKey);';
  if (!source.includes(commandHook)) throw new Error('Unsupported command dispatch; no files changed');
  source = source.replace(commandHook, '      case "blank-cleanup-status":\n        return { id: cmd.id, ok: true, data: await openCliBlankTabStatus() };\n' + commandHook);
  return source + '\n' + guard;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = resolve(process.argv[2] || '/home/ubuntu/opencli-extension-1.0.24');
  const background = join(directory, 'dist/background.js');
  const original = readFileSync(background, 'utf8');
  const patched = patchBackground(original, readFileSync(new URL('./guard.js', import.meta.url), 'utf8'));
  if (original !== patched) {
    const backup = background + '.before-blank-tab-fix';
    if (!existsSync(backup)) writeFileSync(backup, original);
    writeFileSync(background, patched);
  }
  // This local extension page activates the new worker without restarting Chrome.
  writeFileSync(join(directory, 'reload-blank-fix.html'), '<!doctype html><title>Applying OpenCLI tab fix</title><p>Applying OpenCLI tab fix…</p><script src="reload-blank-fix.js"></script>');
  writeFileSync(join(directory, 'reload-blank-fix.js'), 'setTimeout(() => chrome.runtime.reload(), 500);\n');
  console.log(`OpenCLI blank-tab fix installed in ${directory}`);
}
