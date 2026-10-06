// A shared desktop browser can contain several active provider slots and user
// tabs. Cleanup must close the owned target, and retain it if cleanup fails.
export async function closeOwnedSlotPage(slot, reason, clearIdleClose, report = console) {
    clearIdleClose(slot);
    const page = slot.page;
    if (!page) return;
    try {
        await page.closeTab();
        if (slot.page === page) slot.page = null;
        report.log(`[GEMINI WEB] Closed slot ${slot.id} tab (${reason})`);
    } catch (error) {
        report.warn(`[GEMINI WEB] Could not close slot ${slot.id} tab:`, error?.message || error);
    }
}
