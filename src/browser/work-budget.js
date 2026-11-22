import { createConcurrencyLimiter, cpuCapacity, workloadConcurrency } from '../runtime/concurrency-limiter.js';

// Origin queues retain their navigation isolation and interactive priority.
// This additional budget prevents many origins starting renderers together.
const budget = createConcurrencyLimiter(workloadConcurrency('RSS_BROWSER_FETCH_CONCURRENCY', Math.min(2, cpuCapacity())));
export const withBrowserFetchBudget = (run, priority) => budget.run(run, priority);
export const getBrowserFetchBudget = budget.state;
