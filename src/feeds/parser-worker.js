import { Worker } from 'worker_threads';

export function createParserWorker() {
    const workerPath = new URL('../../feed-worker.js', import.meta.url);

    let parserWorker = null;

    let parserRequestId = 0;

    const parserRequests = new Map();

    function ensureParserWorker() {
        if (parserWorker) return parserWorker;
        const worker = new Worker(workerPath);
        parserWorker = worker;
        if (worker.unref) worker.unref();

        worker.on('message', message => {
            const pending = parserRequests.get(message.id);
            if (!pending) return;
            parserRequests.delete(message.id);
            if (message.success) pending.resolve(message.data);
            else pending.reject(new Error(message.error));
        });

        const failWorker = error => {
            if (parserWorker !== worker) return;
            parserWorker = null;
            for (const pending of parserRequests.values()) pending.reject(error);
            parserRequests.clear();
        };
        worker.on('error', failWorker);
        worker.on('exit', code => {
            if (code !== 0) failWorker(new Error(`Parser worker stopped with exit code ${code}`));
            else if (parserWorker === worker) parserWorker = null;
        });
        return worker;
    }

    function runParserWorker(type, data) {
        return new Promise((resolve, reject) => {
            const id = ++parserRequestId;
            parserRequests.set(id, { resolve, reject });
            try {
                ensureParserWorker().postMessage({ id, type, data });
            } catch (error) {
                parserRequests.delete(id);
                reject(error);
            }
        });
    }

    return {
        runParserWorker
    };
}
