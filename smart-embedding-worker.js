import { parentPort } from 'node:worker_threads';

if (!parentPort) {
    throw new Error(
        'smart-embedding-worker.js must be started as a worker thread.'
    );
}

const EMBEDDING_MODEL =
    process.env.SMART_EMBEDDING_MODEL ||
    'Xenova/multilingual-e5-small';

let extractorPromise = null;
let jobQueue = Promise.resolve();

async function loadTransformersLibrary() {
    try {
        const module =
            await import('@huggingface/transformers');

        return {
            module,
            packageName:
                '@huggingface/transformers'
        };
    } catch (huggingFaceError) {
        try {
            const module =
                await import('@xenova/transformers');

            return {
                module,
                packageName:
                    '@xenova/transformers'
            };
        } catch (xenovaError) {
            throw new Error(
                [
                    'No Transformers.js package is installed.',
                    'Install one with:',
                    'npm install @huggingface/transformers',
                    'or:',
                    'npm install @xenova/transformers',
                    '',
                    `@huggingface error: ${huggingFaceError.message}`,
                    `@xenova error: ${xenovaError.message}`
                ].join('\n')
            );
        }
    }
}

async function createExtractor() {
    console.log(
        `[SMART EMBEDDING WORKER] Loading ${EMBEDDING_MODEL}…`
    );

    const {
        module,
        packageName
    } = await loadTransformersLibrary();

    const {
        pipeline,
        env
    } = module;

    if (env) {
        env.allowRemoteModels =
            process.env
                .SMART_EMBEDDING_ALLOW_REMOTE !==
            'false';

        env.allowLocalModels = true;

        const cacheDirectory =
            process.env
                .SMART_TRANSFORMERS_CACHE_DIR ||
            process.env.HF_HOME ||
            '';

        if (cacheDirectory) {
            env.cacheDir =
                cacheDirectory;
        }
    }

    const extractor =
        await pipeline(
            'feature-extraction',
            EMBEDDING_MODEL
        );

    console.log(
        `[SMART EMBEDDING WORKER] Model ready using ${packageName}: ${EMBEDDING_MODEL}`
    );

    return extractor;
}

function getExtractor() {
    if (!extractorPromise) {
        extractorPromise =
            createExtractor().catch(error => {
                extractorPromise = null;
                throw error;
            });
    }

    return extractorPromise;
}

function normalizeVector(vector) {
    let magnitudeSquared = 0;

    for (
        let index = 0;
        index < vector.length;
        index++
    ) {
        const value =
            Number(vector[index]) || 0;

        vector[index] = value;
        magnitudeSquared +=
            value * value;
    }

    const magnitude =
        Math.sqrt(magnitudeSquared);

    if (
        !Number.isFinite(magnitude) ||
        magnitude <= 0
    ) {
        return vector;
    }

    for (
        let index = 0;
        index < vector.length;
        index++
    ) {
        vector[index] /=
            magnitude;
    }

    return vector;
}

function vectorsFromTensor(
    output,
    expectedBatchSize
) {
    const data =
        output?.data;

    if (
        data &&
        Number.isFinite(data.length) &&
        data.length > 0
    ) {
        const vectorSize =
            data.length /
            expectedBatchSize;

        if (
            !Number.isInteger(vectorSize) ||
            vectorSize <= 0
        ) {
            throw new Error(
                `Unexpected embedding tensor size: ${data.length} values for ${expectedBatchSize} texts`
            );
        }

        const vectors = [];

        for (
            let batchIndex = 0;
            batchIndex <
            expectedBatchSize;
            batchIndex++
        ) {
            const start =
                batchIndex * vectorSize;

            const end =
                start + vectorSize;

            const vector =
                new Float32Array(
                    vectorSize
                );

            for (
                let valueIndex = start;
                valueIndex < end;
                valueIndex++
            ) {
                vector[
                    valueIndex - start
                ] =
                    Number(
                        data[valueIndex]
                    ) || 0;
            }

            vectors.push(
                normalizeVector(vector)
            );
        }

        return vectors;
    }

    if (
        typeof output?.tolist ===
        'function'
    ) {
        let list =
            output.tolist();

        if (
            expectedBatchSize === 1 &&
            Array.isArray(list) &&
            list.length &&
            !Array.isArray(list[0])
        ) {
            list = [list];
        }

        if (
            !Array.isArray(list) ||
            list.length !==
            expectedBatchSize
        ) {
            throw new Error(
                'Unexpected embedding output shape.'
            );
        }

        return list.map(values => {
            const flattened =
                Array.isArray(values?.[0])
                    ? values.flat(Infinity)
                    : values;

            if (
                !Array.isArray(flattened) ||
                !flattened.length
            ) {
                throw new Error(
                    'Embedding output contained an empty vector.'
                );
            }

            return normalizeVector(
                Float32Array.from(
                    flattened,
                    value =>
                        Number(value) || 0
                )
            );
        });
    }

    throw new Error(
        'Embedding model returned an unsupported tensor format.'
    );
}

async function generateEmbeddings(
    texts
) {
    const extractor =
        await getExtractor();

    const output =
        await extractor(
            texts,
            {
                pooling: 'mean',
                normalize: true
            }
        );

    try {
        return vectorsFromTensor(
            output,
            texts.length
        );
    } finally {
        if (
            typeof output?.dispose ===
            'function'
        ) {
            try {
                output.dispose();
            } catch {
                // Tensor disposal is optional.
            }
        }
    }
}

function serializeError(error) {
    return {
        name:
            error?.name ||
            'Error',

        message:
            String(
                error?.message ||
                error ||
                'Unknown worker error'
            ).slice(0, 2000),

        stack:
            String(
                error?.stack || ''
            ).slice(0, 5000)
    };
}

async function handleEmbeddingJob(
    message
) {
    const id =
        message?.id;

    const incomingTexts =
        message?.texts;

    const texts =
        Array.isArray(incomingTexts)
            ? incomingTexts
            : (
                typeof incomingTexts ===
                    'string'
                    ? [incomingTexts]
                    : []
            );

    if (!texts.length) {
        throw new Error(
            'Embedding job did not contain any texts.'
        );
    }

    const cleanedTexts =
        texts.map((text, index) => {
            const cleaned =
                String(text || '')
                    .replace(/\s+/g, ' ')
                    .trim();

            if (!cleaned) {
                throw new Error(
                    `Embedding text at index ${index} is empty.`
                );
            }

            return cleaned;
        });

    const startedAt =
        Date.now();

    const vectors =
        await generateEmbeddings(
            cleanedTexts
        );

    if (
        vectors.length !==
        cleanedTexts.length
    ) {
        throw new Error(
            `Expected ${cleanedTexts.length} vectors but received ${vectors.length}`
        );
    }

    const dimensions =
        vectors[0]?.length || 0;

    if (
        !dimensions ||
        vectors.some(
            vector =>
                !(vector instanceof Float32Array) ||
                vector.length !== dimensions
        )
    ) {
        throw new Error(
            'Embedding vectors have inconsistent dimensions.'
        );
    }

    const transferList =
        vectors.map(
            vector =>
                vector.buffer
        );

    parentPort.postMessage(
        {
            type: 'result',
            id,
            vectors,
            count:
                vectors.length,
            dimensions,
            durationMs:
                Date.now() -
                startedAt
        },
        transferList
    );
}

parentPort.on(
    'message',
    message => {
        if (
            message?.type ===
            'ping'
        ) {
            parentPort.postMessage({
                type: 'pong',
                id:
                    message.id || null
            });

            return;
        }

        if (
            message?.type !==
            'embed'
        ) {
            return;
        }

        jobQueue =
            jobQueue
                .catch(() => {
                    // Keep the queue usable after a previous failure.
                })
                .then(() =>
                    handleEmbeddingJob(
                        message
                    )
                )
                .catch(error => {
                    console.error(
                        '[SMART EMBEDDING WORKER] Job failed:',
                        error?.message ||
                        error
                    );

                    parentPort.postMessage({
                        type: 'error',
                        id:
                            message?.id,
                        error:
                            serializeError(
                                error
                            )
                    });
                });
    }
);

parentPort.on(
    'close',
    () => {
        extractorPromise = null;
    }
);

console.log(
    '[SMART EMBEDDING WORKER] Worker initialized.'
);