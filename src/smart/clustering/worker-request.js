// A dead worker cannot publish a result. Release its listeners and caller on
// every terminal path so a refresh does not retain its corpus indefinitely.
export function requestClusterWorker(worker, input, onProgress) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const cleanup = () => {
            worker.off('message', message);
            worker.off('error', error);
            worker.off('exit', exit);
        };
        const finish = (failure, result) => {
            if (settled) return;
            settled = true;
            cleanup();
            failure ? reject(failure) : resolve(result);
        };
        const error = failure => finish(failure);
        const exit = code => finish(new Error(`Smart clustering worker exited ${code} before returning a result`));
        const message = msg => {
            try {
                if (msg.type === 'progress') onProgress(msg.progress);
                else if (msg.type === 'result') finish(null, msg.result);
                else if (msg.type === 'error') finish(new Error(msg.error));
            } catch (failure) { finish(failure); }
        };
        worker.on('message', message);
        worker.once('error', error);
        worker.once('exit', exit);
        try { worker.postMessage(input); } catch (failure) { finish(failure); }
    });
}
