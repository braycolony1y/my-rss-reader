import os from 'node:os';
import { parentPort } from 'node:worker_threads';
import { installClusterWorker } from './src/smart/clustering/worker-runner.js';

try { os.setPriority(0, 15); }
catch (error) { console.warn('[SMART WORKER] Could not lower process priority:', error.message); }

if (parentPort) installClusterWorker(parentPort);
