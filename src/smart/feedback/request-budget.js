// A picker must never inherit an unbounded wait from background AI queues.
// Expired/aborted callbacks are harmless when the shared scheduler later dispatches them.
export const PICKER_AI_BUDGET_MS = 8000;
export function pickerBudgetError() {
    const error = new Error('Finding more reasons took too long. You can try again or use Other.');
    error.code = 'PICKER_TIMEOUT';
    return error;
}
export async function withinPickerBudget(run, { timeoutMs = PICKER_AI_BUDGET_MS, signal } = {}) {
    const deadline = Date.now() + timeoutMs;
    let expired = false, timer, onAbort;
    const remaining = () => {
        if (expired || signal?.aborted || Date.now() >= deadline) throw pickerBudgetError();
        return Math.max(1, deadline - Date.now());
    };
    const stopped = new Promise((_, reject) => {
        onAbort = () => { expired = true; reject(pickerBudgetError()); };
        timer = setTimeout(onAbort, timeoutMs);
        if (signal?.aborted) onAbort();
        else signal?.addEventListener('abort', onAbort, { once: true });
    });
    try { return await Promise.race([Promise.resolve().then(() => { remaining(); return run(remaining); }), stopped]); }
    finally { expired = true; clearTimeout(timer); signal?.removeEventListener('abort', onAbort); }
}
