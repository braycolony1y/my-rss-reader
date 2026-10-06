import { getHeapStatistics } from 'node:v8';
import { readMemoryBudget } from '../../observability/memory-budget.js';

const MB = 1024 * 1024;
const positive = (value, fallback) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback;

// Verification prompts are small compared with the live corpus. Decide from
// remaining V8/cgroup capacity, rather than treating a normal retained corpus
// size as exhausted memory. An intentional operator hard cap remains supported.
export function createReviewMemoryPolicy({
    memory = process.memoryUsage,
    budget = readMemoryBudget,
    heapLimit = () => getHeapStatistics().heap_size_limit,
    heapReserveMB = positive(process.env.SMART_AI_REVIEW_HEAP_RESERVE_MB, 256),
    memoryReserveMB = positive(process.env.SMART_AI_REVIEW_MEMORY_RESERVE_MB, 512),
    hardCapMB = positive(process.env.SMART_AI_REVIEW_HEAP_DEFER_MB, Infinity),
    collect = () => global.gc?.(),
    report = console.warn,
    now = Date.now,
    collectionCooldownMs = 60000,
} = {}) {
    let lastCollection = -Infinity;
    let lastReported = -Infinity;
    function sample() {
        const usage = memory(), capacity = budget(), heapLimitBytes = heapLimit();
        const heapPressure = usage.heapUsed + heapReserveMB * MB >= heapLimitBytes || usage.heapUsed >= hardCapMB * MB;
        const cgroupPressure = capacity.used + memoryReserveMB * MB >= capacity.limit;
        return { defer: heapPressure || cgroupPressure, heapPressure, cgroupPressure,
            memory: usage, budget: capacity, heapLimitBytes, heapReserveMB, memoryReserveMB,
            hardCapMB: Number.isFinite(hardCapMB) ? hardCapMB : null };
    }
    return {
        check(context = {}) {
            let state = sample();
            if (state.defer && now() - lastCollection >= collectionCooldownMs) {
                lastCollection = now(); collect(); state = sample();
            }
            if (!state.defer) lastReported = -Infinity;
            else if (now() - lastReported >= collectionCooldownMs) {
                lastReported = now();
                report('[SMART MEMORY] ai-review-pressure', JSON.stringify({ ...context,
                    heapUsedMB: Math.round(state.memory.heapUsed / MB),
                    usedMB: Math.round(state.budget.used / MB), limitMB: Math.round(state.budget.limit / MB),
                    heapLimitMB: Math.round(state.heapLimitBytes / MB),
                    heapReserveMB, memoryReserveMB, hardCapMB: state.hardCapMB,
                }));
            }
            return state;
        },
    };
}
