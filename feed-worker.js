import { parentPort } from 'worker_threads';
import { 
    fastParseRSS, 
    parseBaoMoi, 
    parseMorningstar, 
    parseTechcombank, 
    parseUOB, 
    parseUOBVN 
} from './server.js';

parentPort.on('message', (msg) => {
    try {
        let result;
        switch (msg.type) {
            case 'fastParseRSS': result = fastParseRSS(msg.data); break;
            case 'parseBaoMoi': result = parseBaoMoi(msg.data); break;
            case 'parseMorningstar': result = parseMorningstar(msg.data); break;
            case 'parseTechcombank': result = parseTechcombank(msg.data); break;
            case 'parseUOB': result = parseUOB(msg.data); break;
            case 'parseUOBVN': result = parseUOBVN(msg.data); break;
            default: throw new Error('Unknown parser type: ' + msg.type);
        }
        parentPort.postMessage({ success: true, data: result });
    } catch (err) {
        parentPort.postMessage({ success: false, error: err.message });
    }
});
