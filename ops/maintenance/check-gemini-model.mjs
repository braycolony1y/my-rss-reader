#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);

function argumentValue(name, fallback) {
    const index = args.indexOf(name);
    return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const model = argumentValue('--model', 'gemini-3.7-flash');
const keyFile = path.resolve(argumentValue('--keys', path.join(repositoryRoot, 'gemini-keys.txt')));
const requestedIndex = Number.parseInt(argumentValue('--key-index', '0'), 10);
const keys = (await readFile(keyFile, 'utf8'))
    .split(/\r?\n/)
    .map(key => key.trim())
    .filter(Boolean);

if (keys.length === 0) {
    throw new Error(`No Gemini keys found in ${keyFile}`);
}

const candidates = requestedIndex > 0
    ? [{ key: keys[requestedIndex - 1], index: requestedIndex }].filter(candidate => candidate.key)
    : keys.map((key, index) => ({ key, index: index + 1 }));

if (candidates.length === 0) {
    throw new Error(`Gemini key index ${requestedIndex} does not exist (configured: ${keys.length})`);
}

let succeeded = false;
for (const candidate of candidates) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);

    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(candidate.key)}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: controller.signal,
                body: JSON.stringify({
                    contents: [{ role: 'user', parts: [{ text: 'Reply with exactly OK.' }] }],
                    generationConfig: {
                        maxOutputTokens: 64,
                        thinkingConfig: { thinkingLevel: 'LOW' }
                    }
                })
            }
        );
        const payload = await response.json().catch(() => ({}));
        const generatedText = payload?.candidates?.[0]?.content?.parts
            ?.map(part => part?.text || '')
            .join('')
            .trim();

        if (response.ok && generatedText) {
            console.log(`[PASS] key ${candidate.index}/${keys.length} generated with ${model}: ${generatedText.slice(0, 40)}`);
            succeeded = true;
            break;
        }

        const message = payload?.error?.message || `No generated text (HTTP ${response.status})`;
        console.error(`[FAIL] key ${candidate.index}/${keys.length} ${model}: HTTP ${response.status} ${message}`);
    } catch (error) {
        const message = error?.name === 'AbortError' ? 'request timed out after 60s' : error?.message;
        console.error(`[FAIL] key ${candidate.index}/${keys.length} ${model}: ${message}`);
    } finally {
        clearTimeout(timeout);
    }
}

process.exitCode = succeeded ? 0 : 1;
