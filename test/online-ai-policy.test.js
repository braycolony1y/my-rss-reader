import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function read(relativePath) {
    return readFile(path.join(repositoryRoot, relativePath), 'utf8');
}

test('production has no Qwen Cloud request path', async () => {
    const productionSource = (await Promise.all([
        read('summary-engine.js'),
        read('smart-news.js'),
        read('server.js')
    ])).join('\n');

    assert.doesNotMatch(productionSource, /dashscope/i);
    assert.doesNotMatch(productionSource, /qwenKeyManager/);
    assert.doesNotMatch(productionSource, /type:\s*['"]qwen['"]/);
    assert.doesNotMatch(productionSource, /QWEN_API_KEY|DASHSCOPE_API_KEY/);
});

test('online AI calls and the private 24-hour exporter are logged', async () => {
    const summarySource = await read('summary-engine.js');
    const smartSource = await read('smart-news.js');
    const exporter = await read('ops/maintenance/export-online-ai-usage-24h.sh');

    assert.match(summarySource, /\[ONLINE AI\]/);
    assert.match(smartSource, /\[ONLINE AI\]/);
    assert.match(exporter, /--since='24 hours ago'/);
    assert.match(exporter, /online-ai-usage-last-24h\.log/);
});
