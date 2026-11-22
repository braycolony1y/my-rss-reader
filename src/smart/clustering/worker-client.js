import { boundedWorkerOptions } from '../../observability/memory-budget.js';
import { Worker } from 'node:worker_threads';

let clusterWorker = null;

function getClusterWorker() {
  if (clusterWorker) return clusterWorker;

  clusterWorker = new Worker(
    new URL('../../../smart-cluster-worker.js', import.meta.url),
    { type: 'module', ...boundedWorkerOptions(1024) }
  );

  clusterWorker.on('error', err => {
    console.error(
      '[SMART CLUSTER WORKER] Fatal error:',
      err?.stack || err?.message || err
    );

    // onnxruntime-node 1.14.0 cannot safely initialize in a
    // replacement worker in the same Node process.
    // Restart the whole service instead.
    setImmediate(() => process.exit(1));
  });

  clusterWorker.on('exit', code => {
    clusterWorker = null;

    console.error(
      `[SMART CLUSTER WORKER] Unexpected exit with code ${code}; restarting service`
    );

    // Never create a second ONNX worker in this Node process.
    setImmediate(() => process.exit(1));
  });

  return clusterWorker;
}

export { getClusterWorker };
