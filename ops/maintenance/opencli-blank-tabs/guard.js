// Runs inside the OpenCLI extension, after its lease registry has recovered.
const blankTabFirstSeen = new Map();
let blankTabCleanupClosed = 0;
const BLANK_CLEANUP_ALARM = 'opencli:blank-tab-cleanup';

function isUnleasedBlankTab(tab, groupIds) {
  if (!tab || tab.url !== 'about:blank' || tab.pendingUrl || tab.status !== 'complete' || tab.pinned || tab.active) return false;
  // Only touch OpenCLI groups or the adapter's own container, never arbitrary windows.
  if (!groupIds.has(tab.groupId) && tab.windowId !== ownedContainers.automation.windowId) return false;
  for (const session of automationSessions.values()) {
    if (session.preferredTabId === tab.id || (session.preferredTabId === null && session.windowId === tab.windowId)) return false;
  }
  return true;
}

async function cleanupOpenCliBlankTabs() {
  await workerReady;
  return withLeaseMutation(async () => {
    // Share the creation queue, but allow unrelated busy sessions to continue.
    // Their leased tabs are protected below; global idleness can never arrive
    // on a continuously polling reader and would starve cleanup indefinitely.
    const groups = await chrome.tabGroups.query({});
    const groupIds = new Set(groups.filter(group =>
      group.title === 'OpenCLI Browser' || group.title === 'OpenCLI Adapter' || interactiveGroupLedger.has(group.id)
    ).map(group => group.id));
    const tabs = await chrome.tabs.query({});
    const candidates = new Set();
    const now = Date.now();
    for (const tab of tabs) {
      if (!isUnleasedBlankTab(tab, groupIds)) continue;
      candidates.add(tab.id);
      if (!blankTabFirstSeen.has(tab.id)) blankTabFirstSeen.set(tab.id, now);
      if (now - blankTabFirstSeen.get(tab.id) < 60_000) continue;
      // Recheck immediately before removing: it may have navigated since the list.
      const current = await chrome.tabs.get(tab.id).catch(() => null);
      if (!isUnleasedBlankTab(current, groupIds)) {
        blankTabFirstSeen.delete(tab.id);
        continue;
      }
      await chrome.tabs.remove(tab.id);
      blankTabFirstSeen.delete(tab.id);
      blankTabCleanupClosed++;
      console.log(`[opencli] Removed orphan blank tab ${tab.id}`);
    }
    for (const id of blankTabFirstSeen.keys()) {
      if (!candidates.has(id)) blankTabFirstSeen.delete(id);
    }
  });
}

async function openCliBlankTabStatus() {
  const tabs = await chrome.tabs.query({});
  const alarm = await chrome.alarms.get(BLANK_CLEANUP_ALARM);
  return {
    patch: 'remove-owned-tabs-v1',
    blankTabs: tabs.filter(tab => tab.url === 'about:blank').length,
    blankTabDetails: tabs.filter(tab => tab.url === 'about:blank').map(tab => ({
      id: tab.id, windowId: tab.windowId, groupId: tab.groupId,
      active: tab.active, pinned: tab.pinned, status: tab.status,
      navigating: Boolean(tab.pendingUrl),
      leased: [...automationSessions.values()].some(session => session.preferredTabId === tab.id)
    })),
    adapterWindowId: ownedContainers.automation.windowId,
    watchedBlankTabs: blankTabFirstSeen.size,
    closedOrphans: blankTabCleanupClosed,
    cleanupPeriodMinutes: alarm?.periodInMinutes ?? null
  };
}

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === BLANK_CLEANUP_ALARM) {
    void cleanupOpenCliBlankTabs().catch(error => console.warn('[opencli] Blank cleanup failed:', String(error)));
  }
});
void workerReady.then(async () => {
  await chrome.alarms.create(BLANK_CLEANUP_ALARM, { delayInMinutes: 1, periodInMinutes: 5 });
  await cleanupOpenCliBlankTabs();
}).catch(error => console.warn('[opencli] Blank cleanup setup failed:', String(error)));
