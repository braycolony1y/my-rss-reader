// A warm same-origin context can fetch without navigation. Reserve its second
// slot for interactive work; ordinary navigations still run one at a time.
export function createBrowserFetchQueue({ canFetchConcurrently = () => false } = {}) {
    const pending = [];
    const jobs = new Map();
    const running = new Set();
    let sequence = 0;
    function pump() {
        const concurrent = canFetchConcurrently();
        const limit = concurrent ? 2 : 1;
        pending.sort((a, b) => a.priority - b.priority || a.sequence - b.sequence);
        while (running.size < limit && pending.length) {
            const next = pending.findIndex(job => !concurrent || job.priority === 0
                || ![...running].some(active => active.priority > 0));
            if (next < 0) return;
            const [job] = pending.splice(next, 1);
            running.add(job);
            Promise.resolve().then(job.run).then(job.resolve, job.reject).finally(() => {
                jobs.delete(job.key);
                running.delete(job);
                pump();
            });
        }
    }
    return {
        run(key, run, priority = 4) {
            const existing = jobs.get(key);
            if (existing) {
                existing.priority = Math.min(existing.priority, priority);
                pump();
                return existing.promise;
            }
            const job = { key, run, priority, sequence: ++sequence };
            job.promise = new Promise((resolve, reject) => Object.assign(job, { resolve, reject }));
            jobs.set(key, job);
            pending.push(job);
            pump();
            return job.promise;
        }
    };
}
