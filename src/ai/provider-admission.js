import {createConcurrencyLimiter} from '../runtime/concurrency-limiter.js';

// The global AI scheduler owns priority. This provider boundary only enforces
// its process ceiling, including asynchronous preparation and cleanup.
export function createProviderAdmission(configured) {
    const value = Number(configured);
    const limit = Math.max(1, Math.min(8, Number.isFinite(value) ? Math.floor(value) : 2));
    const limiter = createConcurrencyLimiter(limit);
    return operation => limiter.run(operation);
}
