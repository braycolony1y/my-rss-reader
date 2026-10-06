import { monitorEventLoopDelay } from 'node:perf_hooks';
import { readMemoryBudget } from './memory-budget.js';
import { getActiveJobs } from '../runtime/coalesced-job.js';

export function startResourceMonitor({ intervalMs = Number(process.env.RSS_RESOURCE_INTERVAL_MS) || 60000,
    collect = () => ({}), report = console.info, memory = process.memoryUsage, cpu = process.cpuUsage,
    now = Date.now, histogram = monitorEventLoopDelay({ resolution: 20 }) } = {}) {
    histogram.enable();
    let lastAt = now(), lastCpu = cpu(), latest = null;
    function sample() {
        const at = now(), usedCpu = cpu(), elapsed = Math.max(1, at - lastAt);
        const usage = memory();
        latest = {
            pid: process.pid, uptime: Math.round(process.uptime()), at,
            ...usage,
            cpuPercent: Math.round(100 * (usedCpu.user + usedCpu.system - lastCpu.user - lastCpu.system) / (elapsed * 1000)),
            eventLoop: { meanMs: Number.isFinite(histogram.mean) ? histogram.mean / 1e6 : 0,
                p50Ms: histogram.percentile(50) / 1e6, p95Ms: histogram.percentile(95) / 1e6,
                p99Ms: histogram.percentile(99) / 1e6, maxMs: histogram.max / 1e6 },
            budget: readMemoryBudget(), jobs: getActiveJobs(), ...collect(),
        };
        lastAt = at; lastCpu = usedCpu; histogram.reset();
        report('[RESOURCES]', JSON.stringify(latest));
        return latest;
    }
    const timer = setInterval(() => { try { sample(); } catch (error) { console.warn('[RESOURCES]', error.message); } }, Math.max(30000, intervalMs));
    timer.unref();
    return { sample, latest: () => latest, stop() { clearInterval(timer); histogram.disable(); } };
}
