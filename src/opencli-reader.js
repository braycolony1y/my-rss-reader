import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function isVerificationPage(data) {
    if (!data || typeof data !== 'object' || !('contentHtml' in data)) return false;
    const frames = data.diagnostics?.frames || [];
    if (String(data.contentHtml).replace(/<[^>]*>/g, '').length < 1500
        && frames.some(frame => /captcha-delivery\.com|challenges\.cloudflare\.com/i.test(frame.src || ''))) return true;
    return /verifying the device|requested content will be available after verification|verify (?:that )?you are (?:a )?human|are you a robot|press\s*(?:&amp;|&|and)\s*hold.*human|enable javascript and cookies to continue|captcha-delivery\.com\/interstitial|please (?:complete|solve) the captcha/i
        .test(`${data.title || ''}\n${data.contentHtml || ''}`);
}

export function isActiveArticleSession(session, url, now = Date.now()) {
    return Boolean(session && session.url === url && now - session.lastSeen < 3000);
}

export async function readWithHumanVerification(read, page, kwargs, canWait) {
    let prompted = false;
    const guardedPage = new Proxy(page, {
        get(target, key) {
            if (key !== 'evaluate') {
                const value = target[key];
                return typeof value === 'function' ? value.bind(target) : value;
            }
            return async (...args) => {
                let data = await target.evaluate(...args);
                while (isVerificationPage(data)) {
                    if (!await canWait()) throw new Error('Publisher verification blocked this fetch.');
                    if (!prompted) {
                        prompted = true;
                        await target.cdp?.('Page.bringToFront').catch(() => {});
                    }
                    await target.wait(1);
                    data = await target.evaluate(...args);
                }
                return data;
            };
        }
    });
    try {
        return await read(guardedPage, kwargs, false);
    } finally {
        // Only the currently viewed article can wait above. All other paths
        // release their own tab, including navigation away during a CAPTCHA.
        await page.closeWindow?.().catch(() => {});
    }
}

export function runOpenCliReader(kwargs, canWait = () => false) {
    return new Promise((resolve, reject) => {
        const child = fork(fileURLToPath(import.meta.url), ['--worker', JSON.stringify(kwargs)], {
            silent: true, execArgv: []
        });
        let stdout = '', stderr = '';
        let timer;
        const resetTimeout = () => {
            clearTimeout(timer);
            timer = setTimeout(() => { child.kill(); }, 60_000);
        };
        resetTimeout();
        child.stdout.on('data', data => {
            stdout += data;
            if (stdout.length > 12 * 1024 * 1024) child.kill();
        });
        child.stderr.on('data', data => { stderr = (stderr + data).slice(-1024 * 1024); });
        child.on('message', message => {
            if (message?.type !== 'verification') return;
            const allowed = Boolean(canWait());
            resetTimeout();
            if (child.connected) child.send({ type: 'verification-decision', allowed });
        });
        child.on('error', error => { clearTimeout(timer); reject(error); });
        child.on('close', code => {
            clearTimeout(timer);
            if (code !== 0) reject(new Error(stderr.trim() || 'OpenCLI reader failed or timed out.'));
            else resolve({ stdout, stderr });
        });
    });
}

if (process.argv[2] === '--worker') {
    let activePage;
    process.on('SIGTERM', async () => {
        await Promise.race([
            activePage?.closeWindow?.().catch(() => {}),
            new Promise(resolve => setTimeout(resolve, 2000))
        ]);
        process.exit(1);
    });
    const canWait = () => new Promise(resolve => {
        const timeout = setTimeout(() => { process.off('message', receive); resolve(false); }, 2000);
        const receive = message => {
            if (message?.type !== 'verification-decision') return;
            clearTimeout(timeout);
            process.off('message', receive);
            resolve(message.allowed === true);
        };
        process.on('message', receive);
        if (process.connected) process.send({ type: 'verification' });
    });
    try {
        const { executeCommand } = await import('../node_modules/@jackwener/opencli/dist/src/execution.js');
        const { setDaemonCommandTimeoutSeconds } = await import('../node_modules/@jackwener/opencli/dist/src/browser/daemon-client.js');
        const { __test__: { command } } = await import('../node_modules/@jackwener/opencli/clis/web/read.js');
        await executeCommand({
            ...command,
            args: [...command.args, { name: 'timeout', type: 'int', default: 86400 }],
            func: (page, kwargs) => {
                activePage = page;
                // Human waiting may be long; individual browser operations must not be.
                setDaemonCommandTimeoutSeconds(20);
                return readWithHumanVerification(command.func, page, kwargs, canWait);
            }
        }, JSON.parse(process.argv[3]), false, { keepTab: 'true', siteSession: 'ephemeral', windowMode: 'background' });
    } catch (error) {
        process.stderr.write(error.message + '\n');
        process.exitCode = 1;
    } finally {
        if (process.connected) process.disconnect();
        // OpenCLI's daemon transport can retain sockets after the adapter ends.
        // This isolated worker owns no further work once the tab is released.
        process.exit(process.exitCode || 0);
    }
}
