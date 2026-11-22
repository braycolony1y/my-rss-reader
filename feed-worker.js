import { parentPort } from 'worker_threads';
import { fastParseRSS } from './feed-parsers.js';

parentPort.on('message', (msg) => {
    try {
        let result;
        switch (msg.type) {
            case 'fastParseRSS': result = fastParseRSS(msg.data); break;
            default: throw new Error('Unknown parser type: ' + msg.type);
        }
        parentPort.postMessage({ id: msg.id, success: true, data: result });
    } catch (err) {
        parentPort.postMessage({ id: msg.id, success: false, error: err.message });
    }
});
