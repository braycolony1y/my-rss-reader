import {
    withLocalCompute
} from './local-compute.js';

// LOCAL_QWEN_FALLBACK_V1

const DEFAULT_MODEL =
    'qwen2.5:3b';

function bounded(
    value,
    min,
    max,
    fallback
) {
    const parsed =
        Number(value);

    return Math.max(
        min,
        Math.min(
            max,
            Number.isFinite(parsed)
                ? parsed
                : fallback
        )
    );
}

function configuredTimeoutMs(
    requested
) {
    const configured =
        bounded(
            process.env
                .SMART_LOCAL_AI_TIMEOUT_MS,
            60_000,
            300_000,
            180_000
        );

    if (
        !Number.isFinite(
            Number(requested)
        )
    ) {
        return configured;
    }

    return bounded(
        requested,
        15_000,
        300_000,
        configured
    );
}

function logUsage(payload) {
    console.log(
        '[ONLINE AI]',
        JSON.stringify({
            at:
                new Date()
                    .toISOString(),
            provider:
                'local-qwen',
            ...payload
        })
    );
}

export function localQwenModel() {
    return (
        process.env
            .OLLAMA_SMART_MODEL ||
        DEFAULT_MODEL
    );
}

export function localQwenConfigured() {
    return (
        process.env
            .SMART_LOCAL_AI_ENABLED !==
        'false'
    );
}

export async function generateWithLocalQwen(
    prompt,
    options = {}
) {
    if (!localQwenConfigured()) {
        const error =
            new Error(
                'Local Qwen provider is disabled'
            );

        error.code =
            'LOCAL_QWEN_DISABLED';

        throw error;
    }

    const model =
        options.model ||
        localQwenModel();

    const baseUrl =
        String(
            options.baseUrl ||
            process.env
                .OLLAMA_BASE_URL ||
            'http://127.0.0.1:11434'
        ).replace(
            /\/$/,
            ''
        );

    const timeoutMs =
        configuredTimeoutMs(
            options.timeoutMs
        );

    const operation =
        options.operation ||
        'summary';

    return withLocalCompute(
        `qwen:${operation}`,
        async () => {
            const controller =
                new AbortController();

            const timeout =
                setTimeout(
                    () =>
                        controller.abort(),
                    timeoutMs
                );

            const startedAt =
                Date.now();

            try {
                options.onRequest?.();

                const body = {
                    model,
                    messages: [
                        {
                            role: 'user',
                            content:
                                String(
                                    prompt ||
                                    ''
                                )
                        }
                    ],
                    stream: false,
                    think: false,
                    keep_alive:
                        process.env
                            .SMART_LOCAL_AI_KEEP_ALIVE ||
                        '2m',
                    options: {
                        temperature: 0,
                        num_ctx:
                            bounded(
                                process.env
                                    .SMART_LOCAL_AI_NUM_CTX,
                                2048,
                                8192,
                                4096
                            ),
                        num_predict:
                            bounded(
                                options.maxTokens ??
                                process.env
                                    .SMART_LOCAL_AI_NUM_PREDICT,
                                128,
                                2048,
                                768
                            ),
                        seed: 17
                    }
                };

                if (options.schema) {
                    body.format =
                        options.schema;
                }
                else if (options.json) {
                    body.format =
                        'json';
                }

                const response =
                    await fetch(
                        `${baseUrl}/api/chat`,
                        {
                            method: 'POST',
                            headers: {
                                'Content-Type':
                                    'application/json'
                            },
                            signal:
                                controller.signal,
                            body:
                                JSON.stringify(
                                    body
                                )
                        }
                    );

                if (!response.ok) {
                    const details =
                        await response
                            .text()
                            .catch(() => '');

                    const error =
                        new Error(
                            `Local Qwen HTTP ${
                                response.status
                            }: ${
                                details.slice(
                                    0,
                                    500
                                )
                            }`
                        );

                    error.status =
                        response.status;

                    error.code =
                        'LOCAL_QWEN_HTTP';

                    throw error;
                }

                const payload =
                    await response.json();

                const text =
                    payload
                        ?.message
                        ?.content ||
                    '';

                if (!text) {
                    const error =
                        new Error(
                            'Local Qwen returned an empty response'
                        );

                    error.code =
                        'LOCAL_QWEN_EMPTY';

                    throw error;
                }

                const durationMs =
                    Date.now() -
                    startedAt;

                const promptTokens =
                    Number(
                        payload
                            ?.prompt_eval_count
                    ) || 0;

                const outputTokens =
                    Number(
                        payload
                            ?.eval_count
                    ) || 0;

                const usage = {
                    promptTokens,
                    outputTokens,
                    totalTokens:
                        promptTokens +
                        outputTokens
                };

                logUsage({
                    operation,
                    model,
                    status: 'success',
                    durationMs,
                    ...usage
                });

                return {
                    text,
                    provider:
                        'local-qwen',
                    modelUsed:
                        model,
                    model,
                    totalDuration:
                        durationMs *
                        1_000_000,
                    usage,
                    onlineAiUsage:
                        usage
                };
            }
            catch (error) {
                const durationMs =
                    Date.now() -
                    startedAt;

                if (
                    error?.name ===
                    'AbortError'
                ) {
                    error.code =
                        'LOCAL_QWEN_TIMEOUT';

                    error.message =
                        `Local Qwen timed out after ${
                            timeoutMs
                        }ms`;
                }

                logUsage({
                    operation,
                    model,
                    status: 'failed',
                    durationMs,
                    errorCode:
                        String(
                            error?.code ||
                            error?.name ||
                            'LOCAL_QWEN_ERROR'
                        ).slice(
                            0,
                            80
                        ),
                    error:
                        String(
                            error?.message ||
                            error
                        ).replace(
                            /\s+/g,
                            ' '
                        ).slice(
                            0,
                            800
                        )
                });

                throw error;
            }
            finally {
                clearTimeout(
                    timeout
                );
            }
        }
    );
}
