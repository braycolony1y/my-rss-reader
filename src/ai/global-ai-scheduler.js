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

        pending.splice(
            index,
            1
        );

        return task;
    }

    return null;
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

    execution
        .then(
            task.resolve,
            task.reject
        )
        .finally(() => {
            active.delete(
                task.id
            );

            dispatch();
        });
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
