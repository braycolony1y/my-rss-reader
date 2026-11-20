import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    BROWSER_CONNECT, ProfileRecovery, classifyBrowserFailure, createBrowserConnectError,
    createChromiumRestarter, findProfileProcessIds, profileConnectedFromStatus, waitFor
} from '../src/browser/profile-recovery.js';
import {
    generateWithGeminiWeb, setGeminiWebProfileRecoveryForTests
} from '../src/ai/gemini-web.js';

const quiet = { warn() {}, log() {} };
const noSleep = () => Promise.resolve();
const deferred = () => {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    return { promise, resolve };
};

// A fake browser whose connectivity flips when "launched".
function fakeBrowser({ connectsAfterLaunch = true, launchGate = null } = {}) {
    const state = { connected: false, launches: 0, waits: 0, rebinds: 0 };
    return {
        state,
        options: {
            probe: async () => ({ connected: state.connected }),
            restartBrowser: async () => {
                state.launches++;
                if (launchGate) await launchGate;
                if (connectsAfterLaunch) state.connected = true;
                return { killedPids: [], removedLocks: ['SingletonLock'], launched: true };
            },
            waitConnected: async () => { state.waits++; return state.connected; },
            onRestarted: () => { state.rebinds++; },
            sleep: noSleep,
            log: quiet
        }
    };
}

test('not connected -> auto-restart -> task succeeds, restart trail recorded', async () => {
    const browser = fakeBrowser();
    const sleeps = [];
    const recovery = new ProfileRecovery({ ...browser.options, sleep: ms => { sleeps.push(ms); return Promise.resolve(); } });
    let runs = 0;

    const { value, recovery: trail } = await recovery.run('xkxs7k9w', async () => { runs++; return 'answer'; });

    assert.equal(value, 'answer');
    assert.equal(runs, 1, 'task is not started against a dead profile');
    assert.equal(browser.state.launches, 1);
    assert.equal(browser.state.rebinds, 1, 'cached tab bindings are dropped after restart');
    assert.equal(trail.restarts, 1);
    assert.equal(trail.attempts[0].action, 'restart');
    assert.equal(trail.attempts[0].outcome, 'connected');
    assert.deepEqual(trail.attempts[0].removedLocks, ['SingletonLock']);
    assert.deepEqual(sleeps, [500], 'short backoff before the first restart');
});

test('connection dropped mid-task is classified, restarted and the task retried', async () => {
    const browser = fakeBrowser();
    browser.state.connected = true;
    const recovery = new ProfileRecovery(browser.options);
    let runs = 0;

    const { value, recovery: trail } = await recovery.run('p', async () => {
        runs++;
        if (runs === 1) {
            browser.state.connected = false;
            throw createBrowserConnectError('Browser profile "p" is not connected');
        }
        return 'ok';
    });

    assert.equal(value, 'ok');
    assert.equal(runs, 2);
    assert.equal(browser.state.launches, 1);
    assert.equal(trail.restarts, 1);
});

test('page crash first rebinds without killing the browser, then restarts if it persists', async () => {
    const browser = fakeBrowser();
    browser.state.connected = true;
    const recovery = new ProfileRecovery(browser.options);
    let runs = 0;

    const { value, recovery: trail } = await recovery.run('p', async () => {
        runs++;
        if (runs <= 2) throw new Error('Target crashed');
        return 'ok';
    });

    assert.equal(value, 'ok');
    assert.equal(trail.attempts[0].action, 'rebind');
    assert.equal(trail.attempts[1].action, 'restart');
    assert.equal(browser.state.launches, 1);
});

test('restarts exhausted -> clear BROWSER_CONNECT error with the attempt trail', async () => {
    const browser = fakeBrowser({ connectsAfterLaunch: false });
    const recovery = new ProfileRecovery({ ...browser.options, maxRetries: 2 });
    let runs = 0;

    await assert.rejects(
        recovery.run('xkxs7k9w', async () => { runs++; return 'never'; }),
        error => {
            assert.equal(error.code, BROWSER_CONNECT);
            assert.match(error.message, /Browser profile "xkxs7k9w" is not connected/);
            assert.match(error.message, /auto-restart exhausted after 2 attempts/);
            assert.equal(error.recovery.restarts, 2);
            assert.equal(error.recovery.attempts.length, 2);
            assert.equal(error.recovery.attempts[1].outcome, 'still-disconnected');
            return true;
        }
    );
    assert.equal(runs, 0);
    assert.equal(browser.state.launches, 2, 'bounded: never more than maxRetries restarts');
});

test('a failing launch is reported as restart-failed and still bounded', async () => {
    const recovery = new ProfileRecovery({
        probe: async () => ({ connected: false }),
        restartBrowser: async () => { throw new Error('Browser profile directory not found: /nope'); },
        waitConnected: async () => false,
        sleep: noSleep, log: quiet, maxRetries: 1
    });
    await assert.rejects(recovery.run('p', async () => 'x'), error => {
        assert.equal(error.code, BROWSER_CONNECT);
        assert.equal(error.recovery.attempts[0].outcome, 'restart-failed');
        assert.match(error.recovery.attempts[0].error, /directory not found/);
        return true;
    });
});

test('maxRetries 0 disables auto-restart but still fails fast with BROWSER_CONNECT', async () => {
    const browser = fakeBrowser();
    const recovery = new ProfileRecovery({ ...browser.options, maxRetries: 0 });
    await assert.rejects(recovery.run('p', async () => 'x'), { code: BROWSER_CONNECT });
    assert.equal(browser.state.launches, 0);
});

test('concurrent callers share one in-flight restart per profile', async () => {
    const gate = deferred();
    const browser = fakeBrowser({ launchGate: gate.promise });
    const recovery = new ProfileRecovery(browser.options);

    const runs = Array.from({ length: 6 }, (_, index) =>
        recovery.run('xkxs7k9w', async () => `job-${index}`));
    // Let every caller reach the shared restart before the browser "launches".
    await waitFor(() => recovery.stats.deduped >= 5, { timeoutMs: 1000, intervalMs: 1 });
    gate.resolve();
    const results = await Promise.all(runs);

    assert.deepEqual(results.map(result => result.value), [0, 1, 2, 3, 4, 5].map(i => `job-${i}`));
    assert.equal(browser.state.launches, 1, 'exactly one browser launch');
    assert.equal(recovery.stats.restarts, 1);
    assert.equal(results.filter(result => result.recovery.attempts[0].joined).length, 5);
});

test('different profiles restart independently', async () => {
    const gate = deferred();
    const browser = fakeBrowser({ launchGate: gate.promise });
    const recovery = new ProfileRecovery(browser.options);
    const a = recovery.restart('a');
    const b = recovery.restart('b');
    gate.resolve();
    await Promise.all([a, b]);
    assert.equal(browser.state.launches, 2);
});

test('profile dropping during a long task fails fast instead of waiting for the command deadline', async () => {
    const browser = fakeBrowser();
    browser.state.connected = true;
    const recovery = new ProfileRecovery({ ...browser.options, maxRetries: 1, watchIntervalMs: 5, watchMisses: 2 });
    let runs = 0;
    const started = Date.now();

    const { value } = await recovery.run('p', ({ restarts }) => {
        runs++;
        if (restarts === 0) {
            browser.state.connected = false;
            return new Promise(() => {}); // a command stuck waiting for the extension
        }
        return Promise.resolve('recovered');
    });

    assert.equal(value, 'recovered');
    assert.equal(runs, 2);
    assert.ok(Date.now() - started < 1000, 'watchdog reacted within milliseconds, not 35 s');
});

test('unrelated task errors are not retried or swallowed', async () => {
    const browser = fakeBrowser();
    browser.state.connected = true;
    const recovery = new ProfileRecovery(browser.options);
    let runs = 0;
    await assert.rejects(recovery.run('p', async () => { runs++; throw Object.assign(new Error('bad json'), { code: 'GEMINI_WEB_INVALID_JSON' }); }), { code: 'GEMINI_WEB_INVALID_JSON' });
    assert.equal(runs, 1);
    assert.equal(browser.state.launches, 0);
});

test('failure classification and daemon status interpretation', () => {
    assert.equal(classifyBrowserFailure(createBrowserConnectError('x')), 'disconnected');
    assert.equal(classifyBrowserFailure(new Error('Browser profile "x" is not connected')), 'disconnected');
    assert.equal(classifyBrowserFailure(new Error('Target crashed')), 'page');
    assert.equal(classifyBrowserFailure(new Error('Gemini Web returned invalid JSON')), null);

    const status = { extensionConnected: true, profiles: [{ contextId: 'other', extensionConnected: true }] };
    assert.deepEqual(profileConnectedFromStatus(status, 'xkxs7k9w'), { connected: false });
    assert.deepEqual(profileConnectedFromStatus(status, 'other'), { connected: true });
    assert.deepEqual(profileConnectedFromStatus(null, 'other'), { connected: null });
});

test('waitFor checks immediately and never sleeps when the condition is already true', async () => {
    let slept = 0;
    assert.equal(await waitFor(() => 'ready', { sleep: () => { slept++; return Promise.resolve(); } }), 'ready');
    assert.equal(slept, 0);
    assert.equal(await waitFor(() => false, { timeoutMs: 20, intervalMs: 5 }), null);
});

test('restarter touches only this profile: kills its processes, clears its stale locks, relaunches', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-recovery-'));
    try {
        const profileDir = path.join(root, 'profile');
        const otherDir = path.join(root, 'other-browser');
        fs.mkdirSync(profileDir);
        fs.mkdirSync(otherDir);
        fs.symlinkSync('host-4242', path.join(profileDir, 'SingletonLock'));
        fs.symlinkSync('123', path.join(profileDir, 'SingletonCookie'));
        fs.symlinkSync('/tmp/gone/SingletonSocket', path.join(profileDir, 'SingletonSocket'));
        fs.symlinkSync('host-9999', path.join(otherDir, 'SingletonLock'));

        const proc = path.join(root, 'proc');
        const fakeProcess = (pid, ...args) => {
            fs.mkdirSync(path.join(proc, String(pid)), { recursive: true });
            fs.writeFileSync(path.join(proc, String(pid), 'cmdline'), args.join('\0') + '\0');
        };
        fakeProcess(4242, '/snap/chromium/1/chrome');                              // lock holder
        fakeProcess(4300, '/snap/chromium/1/chrome', '--type=renderer', `--user-data-dir=${profileDir}`);
        fakeProcess(9999, '/vendor/chromium/chrome', `--user-data-dir=${otherDir}`); // another app's browser
        fakeProcess(5000, '/usr/bin/node', 'server.js');

        const live = new Set([4242, 4300, 9999, 5000]);
        const killed = [];
        const spawned = [];
        const restart = createChromiumRestarter({
            userDataDir: profileDir, command: '/snap/bin/chromium', args: ['--foo'],
            env: { DISPLAY: ':7' }, procRoot: proc, sleep: noSleep, log: quiet,
            alive: pid => live.has(pid),
            kill: (pid, signal) => { killed.push([pid, signal]); live.delete(pid); },
            spawn: (command, args, options) => {
                spawned.push({ command, args, options });
                return { on() {}, unref() {} };
            }
        });

        const detail = await restart();

        assert.deepEqual(detail.killedPids.sort(), [4242, 4300]);
        assert.deepEqual(killed.map(([pid]) => pid).sort(), [4242, 4300]);
        assert.ok(live.has(9999) && live.has(5000), 'unrelated processes are untouched');
        assert.deepEqual(detail.removedLocks.sort(), ['SingletonCookie', 'SingletonLock', 'SingletonSocket']);
        assert.ok(fs.lstatSync(path.join(otherDir, 'SingletonLock')), 'other profile lock is untouched');
        assert.equal(fs.existsSync(path.join(profileDir, 'SingletonLock')) || (() => { try { fs.lstatSync(path.join(profileDir, 'SingletonLock')); return true; } catch { return false; } })(), false);
        assert.equal(spawned.length, 1);
        assert.equal(spawned[0].command, '/snap/bin/chromium');
        assert.ok(spawned[0].args.includes(`--user-data-dir=${profileDir}`));
        assert.ok(spawned[0].args.includes('--foo'));
        assert.equal(spawned[0].options.detached, true);
        assert.equal(spawned[0].options.env.DISPLAY, ':7');

        assert.deepEqual(findProfileProcessIds(otherDir, { procRoot: proc, alive: pid => live.has(pid) }), [9999]);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('restarter refuses to launch when the profile directory does not exist', async () => {
    const restart = createChromiumRestarter({
        userDataDir: '/definitely/not/here', command: 'x', spawn: () => { throw new Error('must not spawn'); }
    });
    await assert.rejects(restart(), /profile directory not found/);
});

test('gemini-web routes every generation through recovery and logs the restart trail', async t => {
    const lines = [];
    const originalLog = console.log;
    console.log = (...args) => { lines.push(args); };
    t.after(() => { console.log = originalLog; setGeminiWebProfileRecoveryForTests(null); });
    const attempt = { n: 1, action: 'restart', outcome: 'connected', reason: 'not connected', durationMs: 4200, killedPids: [], removedLocks: ['SingletonLock'], launched: true };

    setGeminiWebProfileRecoveryForTests({
        run: async () => ({ value: 'hello', recovery: { profile: 'xkxs7k9w', restarts: 1, attempts: [attempt] } })
    });
    const ok = await generateWithGeminiWeb('hi', { operation: 'story-briefing' });
    assert.equal(ok.text, 'hello');
    const success = JSON.parse(lines.find(([tag]) => tag === '[ONLINE AI]')[1]);
    assert.equal(success.status, 'success');
    assert.equal(success.recovery.restarts, 1);
    assert.equal(success.recovery.attempts[0].outcome, 'connected');

    lines.length = 0;
    const failure = createBrowserConnectError('Browser profile "xkxs7k9w" is not connected (auto-restart exhausted after 2 attempts)', {
        recovery: { profile: 'xkxs7k9w', restarts: 2, attempts: [attempt, { ...attempt, n: 2, outcome: 'still-disconnected' }] }
    });
    setGeminiWebProfileRecoveryForTests({ run: async () => { throw failure; } });
    // The previous failure-free job cleared the cooldown; this one sets it.
    await assert.rejects(generateWithGeminiWeb('hi', { operation: 'story-briefing' }), { code: BROWSER_CONNECT });
    const failed = JSON.parse(lines.find(([tag]) => tag === '[ONLINE AI]')[1]);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.errorCode, BROWSER_CONNECT);
    assert.equal(failed.recovery.attempts.length, 2);
});
