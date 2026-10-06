import { availableParallelism } from 'node:os';

export function workloadConcurrency(name, fallback, ceiling = 32) {
    const configured = Number(process.env[name]);
    return Number.isFinite(configured) && configured >= 1
        ? Math.min(ceiling, Math.floor(configured)) : fallback;
}

export const cpuCapacity = () => Math.max(1, Math.min(4, availableParallelism()));

export function createConcurrencyLimiter(limit) {
    if (!Number.isInteger(limit) || limit < 1) throw new RangeError('Concurrency must be a positive integer');
    const pending = [];
    let active = 0, completed = 0, sequence = 0;
    function pump() {
        pending.sort((a, b) => a.priority - b.priority || a.sequence - b.sequence);
        while (active < limit && pending.length) {
            const job = pending.shift(); active++;
            Promise.resolve().then(job.run).then(job.resolve, job.reject).finally(() => {
                active--; completed++; pump();
            });
        }
    }
    return {
        run(run, priority = 0) {
            return new Promise((resolve, reject) => {
                pending.push({ run, priority, sequence: sequence++, resolve, reject }); pump();
            });
        },
        state: () => ({ limit, active, pending: pending.length, completed }),
    };
}
