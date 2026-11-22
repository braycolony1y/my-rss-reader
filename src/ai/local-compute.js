import {
    getGlobalAiTaskLane
} from './global-ai-scheduler.js';

// LOCAL_COMPUTE_MUTEX_V1
//
// Xenova/ONNX and Ollama must not actively compute at the same time on this
// 2-vCPU ARM server.  This is intentionally a mutex, not a model unloader.
// smart-news.js documents that onnxruntime-node 1.14.0 cannot safely recreate
// the Xenova worker after termination in this process.

const queue = [];
let owner = null;
let sequence = 0;

const LANE_ORDER = {
    p0: 0,
    p1: 1,
    p3: 2,
    p4: 3
};

function priorityFor(explicit) {
    if (Number.isFinite(Number(explicit))) {
        return Number(explicit);
    }

    return (
        LANE_ORDER[
            getGlobalAiTaskLane()
        ] ??
        4
    );
}

function pump() {
    if (
        owner ||
        !queue.length
    ) {
        return;
    }

    queue.sort(
        (left, right) =>
            left.priority -
                right.priority ||
            left.sequence -
                right.sequence
    );

    const item =
        queue.shift();

    owner = {
        label: item.label,
        priority: item.priority,
        startedAt: Date.now()
    };

    Promise.resolve()
        .then(item.fn)
        .then(
            item.resolve,
            item.reject
        )
        .finally(() => {
            owner = null;
            pump();
        });
}

export function withLocalCompute(
    label,
    fn,
    options = {}
) {
    if (
        typeof fn !== 'function'
    ) {
        return Promise.reject(
            new TypeError(
                'withLocalCompute requires a function'
            )
        );
    }

    return new Promise(
        (resolve, reject) => {
            queue.push({
                label:
                    String(
                        label ||
                        'local-compute'
                    ),
                fn,
                resolve,
                reject,
                priority:
                    priorityFor(
                        options.priority
                    ),
                sequence:
                    ++sequence
            });

            pump();
        }
    );
}

export function getLocalComputeState() {
    return {
        active:
            owner
                ? { ...owner }
                : null,
        pending:
            queue.map(item => ({
                label: item.label,
                priority: item.priority,
                sequence: item.sequence
            }))
    };
}
