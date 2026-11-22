import path from 'path';
import fs from 'fs/promises';
import { geminiKeyManager } from '../../summary-engine.js';

export function createAiSettings({
    execFileAsync,
} = {}) {
    const ONLINE_AI_USAGE_LOG_FILE = '/home/ubuntu/script/logs/online-ai-usage-last-24h.log';

    const GEMINI_KEYS_FILE = path.resolve('./gemini-keys.txt');

    let geminiKeyWriteChain = Promise.resolve();

    async function readOnlineAiUsageWindow() {
        try {
            const { stdout } = await execFileAsync('/usr/bin/journalctl', [
                '--unit=rss-reader.service',
                '--since=24 hours ago',
                '--no-pager',
                '--output=short-iso',
                '--grep=\\[ONLINE AI\\]|\\[SMART VERIFY\\].*(gemini|qwen)|\\[SUMMARY\\].*(Gemini|Qwen)'
            ], {
                timeout: 15_000,
                maxBuffer: 32 * 1024 * 1024,
                env: { ...process.env, TZ: 'Asia/Ho_Chi_Minh' }
            });
            return { rawLog: stdout, source: 'live service journal' };
        } catch (journalError) {
            try {
                return {
                    rawLog: await fs.readFile(ONLINE_AI_USAGE_LOG_FILE, 'utf8'),
                    source: 'rolling log file',
                    warning: `Live journal unavailable: ${String(journalError.message || journalError).slice(0, 240)}`
                };
            } catch (fileError) {
                const error = new Error('The online AI usage journal and rolling log file are unavailable.');
                error.cause = fileError;
                throw error;
            }
        }
    }

    async function validateGeminiKey(apiKey, model) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15_000);
        try {
            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:countTokens`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-goog-api-key': apiKey
                    },
                    body: JSON.stringify({ contents: [{ parts: [{ text: 'RSS Reader key validation' }] }] }),
                    signal: controller.signal
                }
            );
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                const error = new Error(String(payload?.error?.message || `Gemini returned HTTP ${response.status}`).slice(0, 300));
                error.status = response.status;
                throw error;
            }
            return { httpStatus: response.status, validationTokens: Number(payload.totalTokens) || 0 };
        } finally {
            clearTimeout(timeout);
        }
    }

    async function persistAndActivateGeminiKey(apiKey) {
        const writeOperation = geminiKeyWriteChain.catch(() => {}).then(async () => {
            let configuredKeys = [];
            try {
                configuredKeys = (await fs.readFile(GEMINI_KEYS_FILE, 'utf8'))
                    .split(/\r?\n/)
                    .map(value => value.trim())
                    .filter(Boolean);
            } catch (error) {
                if (error.code !== 'ENOENT') throw error;
            }

            const alreadyConfigured = configuredKeys.includes(apiKey);
            if (!alreadyConfigured) {
                configuredKeys.push(apiKey);
                const temporaryFile = `${GEMINI_KEYS_FILE}.${process.pid}.${Date.now()}.tmp`;
                try {
                    await fs.writeFile(temporaryFile, `${configuredKeys.join('\n')}\n`, { mode: 0o600 });
                    await fs.rename(temporaryFile, GEMINI_KEYS_FILE);
                } finally {
                    await fs.unlink(temporaryFile).catch(() => {});
                }
            }
            await fs.chmod(GEMINI_KEYS_FILE, 0o600);

            const runtime = geminiKeyManager.addKey(apiKey, { activate: true });
            return {
                added: !alreadyConfigured && runtime.added,
                alreadyConfigured,
                index: runtime.index,
                active: runtime.active,
                keyCount: geminiKeyManager.getDebugStats().totalKeys
            };
        });
        geminiKeyWriteChain = writeOperation;
        return writeOperation;
    }

    return {
        readOnlineAiUsageWindow,
        validateGeminiKey,
        persistAndActivateGeminiKey
    };
}
