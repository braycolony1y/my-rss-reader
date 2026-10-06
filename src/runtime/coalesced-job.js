const activeJobs = new Map();
export const getActiveJobs = () => [...activeJobs.values()].map(state => ({ ...state }));

export function createCoalescedJob({ name, run, merge = (_, next) => next, report = console.info }) {
    const token = Symbol(name);
    let active = false, pending = null, coalesced = 0;
    function entry(input) {
        const item = { input };
        item.promise = new Promise((resolve, reject) => Object.assign(item, { resolve, reject }));
        return item;
    }
    async function drain(item) {
        active = true;
        while (item) {
            const startedAt = Date.now(), before = process.memoryUsage();
            activeJobs.set(token, { name, startedAt, pending: false, coalesced });
            report('[JOB START]', JSON.stringify({ name, pid: process.pid, coalesced }));
            let outcome = 'finished', result;
            try { result = await run(item.input); item.resolve(result); }
            catch (error) { outcome = 'failed'; item.reject(error); }
            const after = process.memoryUsage();
            report('[JOB FINISH]', JSON.stringify({ name, outcome, durationMs: Date.now() - startedAt,
                rssDeltaBytes: after.rss - before.rss, heapDeltaBytes: after.heapUsed - before.heapUsed,
                resultCount: result?.clusterCount ?? result?.articleCount ?? null, coalesced }));
            item = pending; pending = null;
        }
        active = false; activeJobs.delete(token);
    }
    return {
        request(input) {
            if (!active) {
                const item = entry(input);
                void drain(item);
                return item.promise;
            }
            if (pending) pending.input = merge(pending.input, input);
            else pending = entry(input);
            coalesced++;
            const state = activeJobs.get(token);
            if (state) Object.assign(state, { pending: true, coalesced });
            report('[JOB COALESCED]', JSON.stringify({ name, coalesced }));
            return pending.promise;
        },
        state: () => ({ active, pending: Boolean(pending), coalesced }),
    };
}
