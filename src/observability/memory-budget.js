import { readFileSync } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

const MB = 1024 * 1024;
export function readMemoryBudget({ read = readFileSync, memory = process.memoryUsage } = {}) {
    const usage = memory();
    try {
        const group = read('/proc/self/cgroup', 'utf8').split('\n').find(line => line.startsWith('0::'))?.slice(3);
        if (group == null) return { ...usage, limit: Infinity, used: usage.rss };
        const directory = path.join('/sys/fs/cgroup', group);
        const number = name => { const value = Number(read(path.join(directory, name), 'utf8').trim()); return value > 0 ? value : Infinity; };
        const limit = Math.min(number('memory.high'), number('memory.max'));
        // File cache is reclaimable. Anonymous pages already swapped out are
        // still part of our working set and must count towards the budget.
        const stat = Object.fromEntries(read(path.join(directory, 'memory.stat'), 'utf8').trim().split('\n').map(line => line.split(/\s+/)));
        const swap = Number(read(path.join(directory, 'memory.swap.current'), 'utf8')) || 0;
        const used = Math.max(usage.rss, (Number(stat.anon) || 0) + (Number(stat.kernel) || 0)) + swap;
        return { ...usage, limit, used, swap };
    } catch { return { ...usage, limit: Infinity, used: usage.rss }; }
}

export function hasWorkerHeadroom(reserveMB = 1280, budget = readMemoryBudget()) {
    return budget.used + reserveMB * MB < budget.limit;
}

// V8's inherited command-line heap size overrides Worker.resourceLimits.
export function boundedWorkerOptions(heapMB) {
    return {
        // Node/test runners inject process-only V8 flags that cannot be passed
        // explicitly to Workers. These workers use native modules and require
        // no loaders or other parent command-line options.
        execArgv: [],
        resourceLimits: { maxOldGenerationSizeMb: heapMB }
    };
}

export function startServiceWatchdog() {
    const interval = Number(process.env.WATCHDOG_USEC) / 2000;
    if (!process.env.NOTIFY_SOCKET || !Number.isFinite(interval) || interval <= 0) return;
    if (process.env.WATCHDOG_PID && Number(process.env.WATCHDOG_PID) !== process.pid) return;
    // systemd handles recovery even when this event loop cannot run at all.
    const timer = setInterval(() => {
        execFile('/usr/bin/systemd-notify', ['WATCHDOG=1'], { timeout: 5000 }, error => {
            if (error) console.warn('[WATCHDOG]', error.message);
        }).unref();
    }, Math.min(20000, interval));
    timer.unref();
}
