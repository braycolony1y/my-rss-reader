// One serial worker for bursts of CPU work. Recycle on configuration changes
// and after idle periods so the caller's current heap budget remains binding.
export function createTaskWorker({ createWorker, workerKey = () => undefined, idleMs = 30000, maxPending = 4, maxJobs = 8 } = {}) {
    let worker, configuration, uses = 0, idle, sequence = 0, active = null, closed = false;
    const pending = new Map(), queue = [];
    function release(error) {
        clearTimeout(idle);
        for (const job of pending.values()) job.reject(error);
        pending.clear();queue.length = 0;active = null;
    }
    async function ensure(input) {
        const key = workerKey(input);
        if (worker && Object.is(configuration, key) && uses < maxJobs) return worker;
        if (worker) {
            const previous = worker;worker = null;
            await previous.terminate();
        }
        if (closed) throw Error('Task worker closed');
        const current = worker = createWorker(input);configuration = key;uses = 0;
        current.on('message', message => {
            if (worker !== current || message.id !== active) return;
            const job = pending.get(message.id);
            if (!job) return;
            pending.delete(message.id);active = null;
            if (message.result?.error) job.reject(Error(message.result.error));
            else job.resolve(message.result);
            if (queue.length) void pump();
            else {
                current.unref();
                idle = setTimeout(() => { if (worker === current) { worker = null;void current.terminate(); } }, idleMs);
                idle.unref();
            }
        });
        current.once('error', error => { if (worker === current) { worker = null;release(error); } });
        current.once('exit', code => {
            if (worker === current) { worker = null;release(Error(`Task worker exited (${code}) before returning a result`)); }
        });
        return current;
    }
    async function pump() {
        if (active !== null || !queue.length || closed) return;
        const job = queue.shift();active = job.id;
        try {
            const current = await ensure(job.input);
            if (closed || !pending.has(job.id)) return;
            current.ref();current.postMessage({ id: job.id, input: job.input });uses++;
        } catch (error) {
            pending.delete(job.id);active = null;job.reject(error);
            if (!pending.size) worker?.unref();
            void pump();
        }
    }
    return {
        run(input) {
            if (closed) return Promise.reject(Error('Task worker closed'));
            if (pending.size >= maxPending) return Promise.reject(Object.assign(Error('Task worker queue is full'), { code: 'WORK_QUEUE_FULL', status: 503 }));
            return new Promise((resolve, reject) => {
                clearTimeout(idle);
                const job = { id: ++sequence, input, resolve, reject };
                pending.set(job.id, job);queue.push(job);void pump();
            });
        },
        async close() {
            closed = true;const current = worker;worker = null;
            release(Error('Task worker closed'));
            if (current) await current.terminate();
        }
    };
}
