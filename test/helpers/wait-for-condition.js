import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';

// Wait for the observed result rather than assuming a worker receives enough
// CPU within a fixed number of polls on the production two-core host.
export async function waitForCondition(predicate, { timeoutMs = 30000, intervalMs = 20 } = {}) {
    const deadline = performance.now() + timeoutMs;
    while (!await predicate()) {
        if (performance.now() >= deadline) throw new Error(`Condition did not complete within ${timeoutMs}ms`);
        await delay(Math.min(intervalMs, Math.max(0, deadline - performance.now())));
    }
}
