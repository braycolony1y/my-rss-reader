import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';

/*
 * Shared browser-profile health, fast-fail and auto-recovery helper.
 *
 * Every web AI provider that drives an OpenCLI browser profile (today:
 * gemini-web) funnels its browser work through ProfileRecovery.run() so that
 * "profile not connected", a dropped bridge connection and a crashed page are
 * handled identically:
 *
 *   1. fast probe of the daemon (milliseconds) instead of waiting for the
 *      daemon's command deadline (35 s) to expire,
 *   2. at most `maxRetries` browser restarts per task with a short backoff,
 *   3. ONE restart in flight per profile; concurrent callers await the same
 *      promise,
 *   4. an auditable attempt trail returned/attached for the task log.
 */

export const BROWSER_CONNECT = 'BROWSER_CONNECT';

const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const DISCONNECT_PATTERNS = [
    /browser profile .* is not connected/i,
    /\bprofile_disconnected\b/i,
    /extension[_ ]not[_ ]connected/i,
    /browser bridge extension not connected/i,
    /connection to the daemon was lost/i,
    /failed to start opencli daemon/i,
    /daemon_shutting_down/i,
    /websocket (is )?(not open|closed)/i
];

const PAGE_PATTERNS = [
    /target (page, context or browser has been )?(crashed|closed)/i,
    /page (has )?crashed/i,
    /\btab_gone\b/i,
    /\battach_failed\b/i,
    /no tab with (given )?id/i,
    /session closed/i,
    /inspected target (navigated or )?closed/i,
    // A native dialog or hung renderer: Runtime.evaluate never answers.
    /\bcdp_timeout\b/i,
    /CDP command .* timed out/i
];

// 'disconnected' -> the whole profile browser is unreachable (restart it).
// 'page'         -> the profile is reachable but the tab/target died (rebind
//                   first; restart the browser only if that does not help).
export function classifyBrowserFailure(error) {
    if (!error) return null;
    const message = String(error.message || error);
    if (error.code === BROWSER_CONNECT || DISCONNECT_PATTERNS.some(p => p.test(message))) {
        return 'disconnected';
    }
    if (/^cdp_timeout$/i.test(String(error.code || ''))) return 'page';
    if (PAGE_PATTERNS.some(p => p.test(message))) return 'page';
    return null;
}

export function createBrowserConnectError(message, { cause, recovery } = {}) {
    const error = new Error(message);
    error.code = BROWSER_CONNECT;
    if (cause) error.cause = cause;
    if (recovery) error.recovery = recovery;
    return error;
}

/*
 * Condition wait with an immediate first check and gentle backoff, replacing
 * fixed sleeps. `read` may be async; resolves with the first truthy value.
 */
export async function waitFor(read, {
    timeoutMs = 5000, intervalMs = 60, maxIntervalMs = 200,
    sleep = defaultSleep, now = Date.now
} = {}) {
    const deadline = now() + timeoutMs;
    let delay = intervalMs;
    for (;;) {
        const value = await read();
        if (value) return value;
        const remaining = deadline - now();
        if (remaining <= 0) return null;
        await sleep(Math.min(delay, remaining));
        delay = Math.min(maxIntervalMs, Math.ceil(delay * 1.5));
    }
}

const keyOf = profile => String(profile || 'default');

export class ProfileRecovery {
    constructor({
        name = 'browser',
        probe,
        restartBrowser,
        waitConnected,
        onRestarted,
        maxRetries = 2,
        backoffMs = [500, 1500],
        launchTimeoutMs = 25000,
        watchIntervalMs = 1000,
        watchMisses = 2,
        sleep = defaultSleep,
        now = Date.now,
        log = console
    } = {}) {
        this.name = name;
        this.probe = probe;
        this.restartBrowser = restartBrowser;
        this.waitConnected = waitConnected;
        this.onRestarted = onRestarted;
        this.maxRetries = Math.max(0, maxRetries);
        this.backoffMs = backoffMs;
        this.launchTimeoutMs = launchTimeoutMs;
        this.watchIntervalMs = watchIntervalMs;
        this.watchMisses = watchMisses;
        this.sleep = sleep;
        this.now = now;
        this.log = log;
        this.inflight = new Map();
        this.stats = { restarts: 0, deduped: 0 };
    }

    // Fast health check. Returns true | false | null (unknown).
    async check(profile) {
        try {
            const result = await this.probe(profile);
            return result?.connected === true ? true : (result?.connected === false ? false : null);
        } catch {
            return null;
        }
    }

    /*
     * Single-flight restart per profile. `force` restarts even when the
     * profile currently looks connected (repeated page-level failure).
     */
    restart(profile, { reason = 'not connected', force = false } = {}) {
        const key = keyOf(profile);
        const running = this.inflight.get(key);
        if (running) {
            this.stats.deduped++;
            return running.then(record => ({ ...record, joined: true }));
        }
        const promise = (async () => {
            const startedAt = this.now();
            const record = { reason: String(reason).slice(0, 300), action: 'none', outcome: 'unknown' };
            try {
                const connected = await this.check(profile);
                if (connected === true && !force) {
                    // A previous restart (or a transient blip) already healed it.
                    record.action = 'rebind';
                    record.outcome = 'connected';
                    await this.onRestarted?.(profile, record);
                } else {
                    record.action = 'restart';
                    this.stats.restarts++;
                    const detail = await this.restartBrowser(profile, { reason });
                    Object.assign(record, detail || {});
                    await this.onRestarted?.(profile, record);
                    const ok = await this.waitConnected(profile, this.launchTimeoutMs);
                    record.outcome = ok ? 'connected' : 'still-disconnected';
                }
            } catch (error) {
                record.outcome = 'restart-failed';
                record.error = String(error?.message || error).slice(0, 300);
            }
            record.durationMs = this.now() - startedAt;
            this.log.warn?.(`[${this.name.toUpperCase()}] profile ${key}: ${record.action} (${record.reason}) -> ${record.outcome} in ${record.durationMs}ms`);
            return record;
        })().finally(() => this.inflight.delete(key));
        this.inflight.set(key, promise);
        return promise;
    }

    // Reject quickly when the profile drops while a task is running.
    _watch(profile, taskPromise) {
        let timer = null;
        let stopped = false;
        let misses = 0;
        const watchdog = new Promise((_, reject) => {
            const tick = async () => {
                if (stopped) return;
                const connected = await this.check(profile);
                if (stopped) return;
                misses = connected === false ? misses + 1 : 0;
                if (misses >= this.watchMisses) {
                    reject(createBrowserConnectError(`Browser profile "${keyOf(profile)}" is not connected`));
                    return;
                }
                timer = setTimeout(tick, this.watchIntervalMs);
                timer.unref?.();
            };
            timer = setTimeout(tick, this.watchIntervalMs);
            timer.unref?.();
        });
        const stop = () => { stopped = true; clearTimeout(timer); };
        // The abandoned task may still reject later; never leave it unhandled.
        taskPromise.catch(() => {});
        return Promise.race([taskPromise, watchdog]).finally(stop);
    }

    /*
     * Run `task` against a profile with fast-fail and bounded auto-recovery.
     * Resolves { value, recovery }. On failure the thrown error carries
     * `.recovery` ({ restarts, attempts, maxRetries }).
     */
    async run(profile, task, { watch = true } = {}) {
        const recovery = { profile: keyOf(profile), restarts: 0, maxRetries: this.maxRetries, attempts: [] };
        let pageFailures = 0;

        const recover = async (reason, kind, original) => {
            if (recovery.restarts >= this.maxRetries) {
                throw this._exhausted(profile, recovery, original);
            }
            recovery.restarts++;
            const wait = this.backoffMs[Math.min(recovery.restarts - 1, this.backoffMs.length - 1)] ?? 0;
            if (wait > 0) await this.sleep(wait);
            const force = kind === 'disconnected' || pageFailures > 1;
            const record = await this.restart(profile, { reason, force });
            recovery.attempts.push({ n: recovery.restarts, backoffMs: wait, ...record });
        };

        for (;;) {
            // Fast-fail: do not hand a dead profile to a command that would sit
            // for its whole deadline waiting for the extension to reappear.
            if (await this.check(profile) === false) {
                await recover(`Browser profile "${keyOf(profile)}" is not connected`, 'disconnected');
                continue;
            }
            try {
                const running = Promise.resolve().then(() => task({ restarts: recovery.restarts }));
                const value = await (watch ? this._watch(profile, running) : running);
                return { value, recovery };
            } catch (error) {
                const kind = classifyBrowserFailure(error);
                if (!kind) {
                    if (error && typeof error === 'object' && recovery.attempts.length) error.recovery = recovery;
                    throw error;
                }
                if (kind === 'page') pageFailures++;
                await recover(String(error.message || error), kind, error);
            }
        }
    }

    _exhausted(profile, recovery, original) {
        const last = recovery.attempts[recovery.attempts.length - 1];
        const base = original?.code === BROWSER_CONNECT && original?.message
            ? original.message.replace(/ \(auto-restart exhausted.*$/, '')
            : `Browser profile "${keyOf(profile)}" is not connected`;
        const suffix = recovery.restarts
            ? ` (auto-restart exhausted after ${recovery.restarts} attempt${recovery.restarts === 1 ? '' : 's'}${last ? `; last: ${last.action} -> ${last.outcome}` : ''})`
            : '';
        return createBrowserConnectError(base + suffix, { cause: original, recovery });
    }
}

// ---------------------------------------------------------------------------
// Default wiring: OpenCLI daemon probe + chromium profile restarter.
// ---------------------------------------------------------------------------

export function profileConnectedFromStatus(status, profile) {
    if (!status) return { connected: null };
    const profiles = Array.isArray(status.profiles) ? status.profiles : null;
    if (profile && profiles) {
        return { connected: profiles.some(p => p.contextId === profile && p.extensionConnected !== false) };
    }
    if (profile && status.contextId === profile) return { connected: status.extensionConnected === true };
    if (profile) return { connected: false };
    return { connected: status.extensionConnected === true };
}

export function createDaemonProbe(fetchStatus, { timeoutMs = 1500 } = {}) {
    return async profile => profileConnectedFromStatus(await fetchStatus({ timeout: timeoutMs }), profile);
}

const SINGLETON_FILES = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];

function pidAlive(pid) {
    try { process.kill(pid, 0); return true; } catch (error) { return error?.code === 'EPERM'; }
}

export function readLockPid(userDataDir, fsImpl = fs) {
    try {
        const target = fsImpl.readlinkSync(path.join(userDataDir, 'SingletonLock'));
        const pid = Number(String(target).split('-').pop());
        return Number.isInteger(pid) && pid > 0 ? pid : null;
    } catch {
        return null;
    }
}

// Only processes launched with this exact --user-data-dir, plus the pid named
// by this profile's own SingletonLock. Other browsers are never matched.
export function findProfileProcessIds(userDataDir, {
    fsImpl = fs, procRoot = '/proc', alive = pidAlive, selfPid = process.pid
} = {}) {
    const needle = `--user-data-dir=${userDataDir}`;
    const found = new Set();
    let entries = [];
    try { entries = fsImpl.readdirSync(procRoot); } catch { /* no /proc */ }
    for (const entry of entries) {
        if (!/^\d+$/.test(entry) || Number(entry) === selfPid) continue;
        try {
            const args = fsImpl.readFileSync(path.join(procRoot, entry, 'cmdline'), 'utf8').split('\0');
            if (args.includes(needle)) found.add(Number(entry));
        } catch { /* process vanished */ }
    }
    const lockPid = readLockPid(userDataDir, fsImpl);
    if (lockPid && lockPid !== selfPid && alive(lockPid)) {
        try {
            const cmd = fsImpl.readFileSync(path.join(procRoot, String(lockPid), 'cmdline'), 'utf8');
            if (/chrom/i.test(cmd)) found.add(lockPid);
        } catch { /* not ours */ }
    }
    return [...found];
}

export function removeStaleLocks(userDataDir, fsImpl = fs) {
    const removed = [];
    for (const name of SINGLETON_FILES) {
        const file = path.join(userDataDir, name);
        try {
            fsImpl.lstatSync(file);
            fsImpl.unlinkSync(file);
            removed.push(name);
        } catch { /* absent */ }
    }
    return removed;
}

export function createChromiumRestarter({
    userDataDir, command, args = [], env = process.env,
    fsImpl = fs, spawn = nodeSpawn, kill = process.kill.bind(process), alive = pidAlive,
    procRoot = '/proc', sleep = defaultSleep, termGraceMs = 3000, log = console
}) {
    return async function restartBrowser() {
        if (!userDataDir || !fsImpl.existsSync(userDataDir)) {
            throw new Error(`Browser profile directory not found: ${userDataDir || '(unset)'}`);
        }
        const detail = { killedPids: [], removedLocks: [], launched: false };
        const pids = findProfileProcessIds(userDataDir, { fsImpl, procRoot, alive });
        for (const pid of pids) { try { kill(pid, 'SIGTERM'); } catch { /* gone */ } }
        if (pids.length) {
            const gone = await waitFor(() => pids.every(pid => !alive(pid)), {
                timeoutMs: termGraceMs, intervalMs: 100, maxIntervalMs: 250, sleep
            });
            if (!gone) {
                for (const pid of pids.filter(alive)) { try { kill(pid, 'SIGKILL'); } catch { /* gone */ } }
                await waitFor(() => pids.every(pid => !alive(pid)), { timeoutMs: 2000, intervalMs: 100, sleep });
            }
            detail.killedPids = pids;
        }
        // A live holder after SIGKILL means we do not own the lock; do not
        // delete it from under a running browser.
        if (!pids.some(alive)) detail.removedLocks = removeStaleLocks(userDataDir, fsImpl);

        const launchEnv = { ...env };
        launchEnv.DISPLAY ||= ':0';
        const xauth = path.join(os.homedir(), '.Xauthority');
        if (!launchEnv.XAUTHORITY && fsImpl.existsSync(xauth)) launchEnv.XAUTHORITY = xauth;
        const child = spawn(command, [
            `--user-data-dir=${userDataDir}`,
            '--no-first-run', '--no-default-browser-check', '--disable-session-crashed-bubble',
            ...args
        ], { detached: true, stdio: 'ignore', env: launchEnv });
        child.on?.('error', error => log.warn?.(`[BROWSER RECOVERY] launch error: ${error.message}`));
        child.unref?.();
        detail.launched = true;
        return detail;
    };
}

export function createDefaultProfileRecovery({
    name = 'browser', env = process.env, fetchStatus, restartBrowser, overrides = {}
} = {}) {
    const number = (value, fallback) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
    };
    const maxRetries = env.RSS_BROWSER_AUTO_RESTART === '0'
        ? 0 : Math.min(2, number(env.RSS_BROWSER_MAX_RESTARTS, 2));
    const userDataDir = env.RSS_BROWSER_USER_DATA_DIR
        || path.join(os.homedir(), 'snap', 'chromium', 'common', 'chromium');
    const probe = createDaemonProbe(fetchStatus);
    return new ProfileRecovery({
        name, probe, maxRetries,
        launchTimeoutMs: number(env.RSS_BROWSER_LAUNCH_TIMEOUT_MS, 25000),
        restartBrowser: restartBrowser || createChromiumRestarter({
            userDataDir,
            command: env.RSS_BROWSER_COMMAND || '/snap/bin/chromium',
            args: String(env.RSS_BROWSER_ARGS || '').split(/\s+/).filter(Boolean),
            env
        }),
        waitConnected: async (profile, timeoutMs) => Boolean(await waitFor(
            async () => (await probe(profile)).connected === true,
            { timeoutMs, intervalMs: 150, maxIntervalMs: 500 }
        )),
        ...overrides
    });
}
