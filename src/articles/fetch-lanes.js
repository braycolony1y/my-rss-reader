// ARTICLE_FETCH_PRIORITY_LANES_V1
import { AsyncLocalStorage } from 'node:async_hooks';
import { createConcurrencyLimiter, cpuCapacity, workloadConcurrency } from '../runtime/concurrency-limiter.js';

const laneStorage = new AsyncLocalStorage();
const originQueues = new Map();
const VALID_LANES = new Set(['p0', 'p1', 'p2', 'p3', 'p4']);
const foreground = createConcurrencyLimiter(workloadConcurrency('RSS_FOREGROUND_FETCH_CONCURRENCY', cpuCapacity() * 2));
export function getArticleFetchQueueState() {
    let queued = 0, active = 0;
    for (const origin of originQueues.values()) for (const queue of Object.values(origin)) {
        queued += queue.high.length + queue.low.length; active += Number(queue.running);
    }
    return { foreground: foreground.state(), other: { active, pending: queued }, origins: originQueues.size };
}

function normalizeLane(value) {
    const lane = String(value || '').toLowerCase();
    return VALID_LANES.has(lane) ? lane : 'p0';
}

function originFor(value) {
    try {
        return new URL(String(value || '')).origin;
    } catch {
        return 'invalid-origin';
    }
}

function queueFor(origin, group) {
    let perOrigin = originQueues.get(origin);
    if (!perOrigin) {
        perOrigin = {};
        originQueues.set(origin, perOrigin);
    }
    if (!perOrigin[group]) {
        perOrigin[group] = { running: false, high: [], low: [] };
    }
    return perOrigin[group];
}

function maybeDeleteOrigin(origin) {
    const perOrigin = originQueues.get(origin);
    if (!perOrigin) return;
    const busy = Object.values(perOrigin).some(q =>
        q && (q.running || q.high.length || q.low.length)
    );
    if (!busy) originQueues.delete(origin);
}

function pump(origin, group, queue) {
    if (queue.running) return;
    const job = queue.high.shift() || queue.low.shift();
    if (!job) {
        maybeDeleteOrigin(origin);
        return;
    }

    queue.running = true;
    const waitedMs = Date.now() - job.enqueuedAt;
    console.log(`[FETCH LANE] START ${job.lane} ${group} ${origin} waitedMs=${waitedMs}`);

    Promise.resolve()
        .then(() => laneStorage.run(job.context, job.task))
        .then(job.resolve, job.reject)
        .finally(() => {
            queue.running = false;
            pump(origin, group, queue);
        });
}

export function getCurrentArticleFetchLaneContext() {
    return laneStorage.getStore() || { lane: 'p0', source: 'default' };
}

export function withArticleFetchLane(lane, fn, extra = {}) {
    const parent = getCurrentArticleFetchLaneContext();
    return laneStorage.run(
        { ...parent, ...extra, lane: normalizeLane(lane) },
        fn
    );
}

export function classifyArticleFetchRequest(req) {
    const query = req?.query || {};
    if (String(query.prefetch || '') === '1' && String(query.threadPage || '') === '1') {
        return 'p1';
    }
    if (String(query.prefetch || '') === '1') return 'p2';
    return 'p0';
}

export function articleFetchLaneMiddleware(req, res, next) {
    const lane = classifyArticleFetchRequest(req);
    const context = {
        lane,
        source: 'article-route',
        requestId: String(req?.query?.requestId || ''),
        url: String(req?.query?.url || '')
    };
    laneStorage.run(context, next);
}

export function runArticleFetchTask(url, task) {
    const context = { ...getCurrentArticleFetchLaneContext() };
    const lane = normalizeLane(context.lane);
    context.lane = lane;
    const origin = originFor(url);

    if (lane === 'p0') {
        console.log(`[FETCH LANE] START p0 burst ${origin} waitedMs=0`);
        return foreground.run(() => laneStorage.run(context, task));
    }

    const reading = lane === 'p1' || lane === 'p2';
    const group = reading ? 'reading' : 'background';
    const queue = queueFor(origin, group);
    const high = lane === 'p1' || lane === 'p3';

    return new Promise((resolve, reject) => {
        (high ? queue.high : queue.low).push({
            lane,
            context,
            task,
            resolve,
            reject,
            enqueuedAt: Date.now()
        });
        pump(origin, group, queue);
    });
}
