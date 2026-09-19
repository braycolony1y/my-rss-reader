import { AsyncLocalStorage } from 'node:async_hooks';

const context = new AsyncLocalStorage();

const pending = [];
const active = new Map();

let readingMode = false;
let lowTurn = 'p3';
let sequence = 0;
let dispatching = false;
let wakeTimer = null;

const LANES =
    new Set([
        'p0',
        'p1',
        'p3',
        'p4'
    ]);



// GLOBAL_AI_BACKGROUND_FRESHNESS_V1
//
// The existing lane policy remains authoritative:
// - reading: P0=2, P1=2, P3/P4=1 shared;
// - not reading: two total jobs with P3/P4 fair alternation.
//
// Freshness is ONLY an ordering rule inside the lane that has already won.
// Foreground/user work ignores age. Background work is ordered by rolling
// 24-hour windows (W0..W6, then older/unknown).
const BACKGROUND_WINDOW_MS =
    24 * 60 * 60 * 1000;

function dynamicTaskValue(task, getter, field, fallback = null) {
    try {
        if (typeof task?.[getter] === 'function') {
            return task[getter]();
        }
        if (Object.prototype.hasOwnProperty.call(task || {}, field)) {
            return task[field];
        }
    }
    catch {
        // Dynamic priority metadata is advisory; lane correctness wins.
    }
    return fallback;
}

function backgroundFor(task) {
    return Boolean(
        dynamicTaskValue(
            task,
            'getBackground',
            'background',
            false
        )
    );
}

function freshnessAtFor(task) {
    const value =
        dynamicTaskValue(
            task,
            'getFreshnessAt',
            'freshnessAt',
            0
        );

    if (value instanceof Date) {
        return value.getTime();
    }

    if (typeof value === 'string') {
        const parsed = Date.parse(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    return Math.max(0, Number(value) || 0);
}

function backgroundRankFor(task) {
    return Number(
        dynamicTaskValue(
            task,
            'getBackgroundRank',
            'backgroundRank',
            0
        )
    ) || 0;
}

function freshnessBucketFor(task) {
    if (!backgroundFor(task)) {
        return -1;
    }

    const at = freshnessAtFor(task);
    if (!at) {
        return 7;
    }

    const age =
        Math.max(
            0,
            Date.now() - at
        );

    return Math.min(
        7,
        Math.floor(
            age / BACKGROUND_WINDOW_MS
        )
    );
}

function taskBefore(left, right) {
    const leftBackground =
        backgroundFor(left);
    const rightBackground =
        backgroundFor(right);

    if (leftBackground !== rightBackground) {
        return !leftBackground;
    }

    if (leftBackground) {
        const leftBucket =
            freshnessBucketFor(left);
        const rightBucket =
            freshnessBucketFor(right);

        if (leftBucket !== rightBucket) {
            return leftBucket < rightBucket;
        }

        const leftRank =
            backgroundRankFor(left);
        const rightRank =
            backgroundRankFor(right);

        if (leftRank !== rightRank) {
            return leftRank > rightRank;
        }

        const leftAt =
            freshnessAtFor(left);
        const rightAt =
            freshnessAtFor(right);

        if (leftAt !== rightAt) {
            return leftAt > rightAt;
        }
    }

    return Number(left?.id || 0) < Number(right?.id || 0);
}


function normalizeLane(value) {
    const lane =
        String(value || '')
            .trim()
            .toLowerCase();

    return LANES.has(lane)
        ? lane
        : 'p4';
}


function laneFor(task) {
    let lane;

    try {
        lane =
            normalizeLane(
                typeof task.getLane === 'function'
                    ? task.getLane()
                    : task.lane
            );
    }
    catch {
        lane = 'p4';
    }

    /*
     * Foreground work still waiting when reading stops
     * becomes ordinary low-priority work.
     */
    if (
        !readingMode &&
        (
            lane === 'p0' ||
            lane === 'p1'
        )
    ) {
        return 'p4';
    }

    return lane;
}


function notBeforeFor(task) {
    try {
        const value =
            typeof task.getNotBefore === 'function'
                ? task.getNotBefore()
                : task.notBefore;

        return Math.max(
            0,
            Number(value) || 0
        );
    }
    catch {
        return 0;
    }
}


function ready(task) {
    return (
        notBeforeFor(task) <= Date.now()
    );
}


function activeCount(lane) {
    let count = 0;

    for (const item of active.values()) {
        if (item.lane === lane) {
            count++;
        }
    }

    return count;
}


function activeLowCount() {
    return (
        activeCount('p3') +
        activeCount('p4')
    );
}


function takeLane(lane) {
    let bestIndex = -1;
    let bestTask = null;

    for (
        let index = 0;
        index < pending.length;
        index++
    ) {
        const task =
            pending[index];

        if (
            !ready(task) ||
            laneFor(task) !== lane
        ) {
            continue;
        }

        if (
            bestTask === null ||
            taskBefore(
                task,
                bestTask
            )
        ) {
            bestTask = task;
            bestIndex = index;
        }
    }

    if (bestIndex < 0) {
        return null;
    }

    pending.splice(
        bestIndex,
        1
    );

    return bestTask;
}


function takeLow() {
    const preferred =
        lowTurn;

    const other =
        preferred === 'p3'
            ? 'p4'
            : 'p3';

    const task =
        takeLane(preferred) ||
        takeLane(other);

    if (!task) {
        return null;
    }

    const lane =
        laneFor(task);

    lowTurn =
        lane === 'p3'
            ? 'p4'
            : 'p3';

    return {
        task,
        lane
    };
}


function startTask(task, lane) {
    active.set(
        task.id,
        {
            lane,
            label:
                task.label || null
        }
    );

    if (
        process.env.GLOBAL_AI_SCHED_DEBUG === '1'
    ) {
        console.log(
            '[GLOBAL AI SCHED]',
            JSON.stringify({
                event: 'start',
                lane,
                label:
                    task.label || null,
                active:
                    active.size
            })
        );
    }

    const execution =
        context.run(
            {
                authorized: true,
                lane
            },
            () =>
                Promise.resolve()
                    .then(task.fn)
        );

    execution.then(
        value => {
            active.delete(
                task.id
            );

            task.resolve(
                value
            );

            dispatch();
        },
        error => {
            active.delete(
                task.id
            );

            const retryAt =
                Number(
                    error?.retryAt
                ) || 0;

            // GLOBAL_AI_DEFER_REQUEUE_V1
            // A known short provider cooldown is not a failed user/background
            // job. Release the occupied scheduler position and put the same
            // task back into pending until its exact retry time.
            if (
                error?.code ===
                    'AI_PROVIDER_DEFERRED' &&
                retryAt >
                    Date.now()
            ) {
                task.notBefore =
                    Math.max(
                        Number(
                            task.notBefore
                        ) || 0,
                        retryAt
                    );

                task.deferredUntil =
                    retryAt;

                pending.push(
                    task
                );

                if (
                    process.env.GLOBAL_AI_SCHED_DEBUG === '1'
                ) {
                    console.log(
                        '[GLOBAL AI SCHED]',
                        JSON.stringify({
                            event:
                                'provider-deferred',
                            lane,
                            label:
                                task.label || null,
                            retryAt:
                                new Date(
                                    retryAt
                                ).toISOString()
                        })
                    );
                }

                dispatch();
                return;
            }

            task.reject(
                error
            );

            dispatch();
        }
    );
}


function armWakeTimer() {
    if (wakeTimer) {
        clearTimeout(
            wakeTimer
        );

        wakeTimer = null;
    }

    let earliest =
        Infinity;

    const now =
        Date.now();

    for (const task of pending) {
        const timestamp =
            notBeforeFor(task);

        if (
            timestamp > now &&
            timestamp < earliest
        ) {
            earliest =
                timestamp;
        }
    }

    if (
        !Number.isFinite(
            earliest
        )
    ) {
        return;
    }

    wakeTimer =
        setTimeout(
            () => {
                wakeTimer = null;
                dispatch();
            },
            Math.max(
                1,
                earliest - now
            )
        );

    wakeTimer.unref?.();
}


function dispatch() {
    if (dispatching) {
        return;
    }

    dispatching = true;

    try {
        let progressed = true;

        while (progressed) {
            progressed = false;

            if (readingMode) {
                /*
                 * READING
                 *
                 * P0 = 2
                 * P1 = 2
                 * P3/P4 = 1 shared
                 *
                 * Two already-running low tasks may temporarily
                 * remain during the transition, allowing 6 total.
                 */

                for (
                    const lane of [
                        'p0',
                        'p1'
                    ]
                ) {
                    while (
                        activeCount(lane) < 2
                    ) {
                        const task =
                            takeLane(lane);

                        if (!task) {
                            break;
                        }

                        startTask(
                            task,
                            lane
                        );

                        progressed =
                            true;
                    }
                }

                if (
                    activeLowCount() < 1
                ) {
                    const next =
                        takeLow();

                    if (next) {
                        startTask(
                            next.task,
                            next.lane
                        );

                        progressed =
                            true;
                    }
                }
            }
            else {
                /*
                 * NOT READING
                 *
                 * Two total jobs.
                 * P3/P4 fair alternation.
                 */

                while (
                    active.size < 2
                ) {
                    const next =
                        takeLow();

                    if (!next) {
                        break;
                    }

                    startTask(
                        next.task,
                        next.lane
                    );

                    progressed =
                        true;
                }
            }
        }
    }
    finally {
        dispatching = false;
        armWakeTimer();
    }
}


export function globalAiTaskActive() {
    return (
        context
            .getStore()
            ?.authorized === true
    );
}


export function runGlobalAiTask(
    options = {},
    fn
) {
    if (
        typeof fn !== 'function'
    ) {
        return Promise.reject(
            new TypeError(
                'runGlobalAiTask requires a function'
            )
        );
    }

    /*
     * Provider fallback calls inside the same authorized
     * task inherit that scheduler position.
     */
    if (
        globalAiTaskActive()
    ) {
        return Promise.resolve()
            .then(fn);
    }

    return new Promise(
        (resolve, reject) => {
            pending.push({
                id:
                    ++sequence,

                lane:
                    options.lane ||
                    'p4',

                getLane:
                    options.getLane ||
                    null,

                notBefore:
                    options.notBefore ||
                    0,

                getNotBefore:
                    options.getNotBefore ||
                    null,

                // Background/freshness metadata never changes lane assignment.
                background:
                    options.background ??
                    false,

                getBackground:
                    options.getBackground ||
                    null,

                freshnessAt:
                    options.freshnessAt ||
                    0,

                getFreshnessAt:
                    options.getFreshnessAt ||
                    null,

                backgroundRank:
                    options.backgroundRank ||
                    0,

                getBackgroundRank:
                    options.getBackgroundRank ||
                    null,

                label:
                    options.label ||
                    null,

                fn,
                resolve,
                reject
            });

            dispatch();
        }
    );
}


export function setGlobalAiReadingMode(activeReading) {
    const next =
        Boolean(
            activeReading
        );

    if (
        readingMode === next
    ) {
        dispatch();
        return;
    }

    readingMode =
        next;

    console.log(
        '[GLOBAL AI SCHED]',
        JSON.stringify({
            event:
                'reading-mode',
            reading:
                readingMode,
            active:
                active.size,
            pending:
                pending.length
        })
    );

    dispatch();
}


export function getGlobalAiTaskLane() {
    return (
        context
            .getStore()
            ?.lane ||
        null
    );
}


export function getGlobalAiSchedulerState() {
    return {
        reading:
            readingMode,

        active: {
            total:
                active.size,
            p0:
                activeCount('p0'),
            p1:
                activeCount('p1'),
            p3:
                activeCount('p3'),
            p4:
                activeCount('p4'),
            low:
                activeLowCount()
        },

        pending:
            pending.length
    };
}
