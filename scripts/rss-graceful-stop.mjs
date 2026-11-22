import { requestDaemonShutdown } from '../node_modules/@jackwener/opencli/dist/src/browser/daemon-transport.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const mainPid = Number(process.argv[2] || 0);

if (Number.isInteger(mainPid) && mainPid > 1) {
    try {
        process.kill(mainPid, 'SIGTERM');
        console.log(`[RSS STOP] Sent SIGTERM to main PID ${mainPid}`);
    } catch (error) {
        if (error?.code !== 'ESRCH') {
            console.warn(
                `[RSS STOP] Could not signal main PID ${mainPid}: ${error?.message || error}`
            );
        }
    }

    const deadline = Date.now() + 3000;

    while (Date.now() < deadline) {
        try {
            process.kill(mainPid, 0);
            await sleep(100);
        } catch (error) {
            if (error?.code === 'ESRCH') break;
            break;
        }
    }
}

try {
    const ok = await requestDaemonShutdown({ timeout: 5000 });
    console.log(
        `[RSS STOP] OpenCLI daemon shutdown request: ${
            ok ? 'accepted' : 'not-running-or-failed'
        }`
    );
} catch (error) {
    console.warn(
        `[RSS STOP] OpenCLI daemon shutdown error: ${error?.message || error}`
    );
}
