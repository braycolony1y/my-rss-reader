import { readServerSource } from './helpers/server-source.js';
import { readSmartSource } from './helpers/smart-source.js';
import { readReaderClientSource, readReaderHtml } from './helpers/reader-source.js';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function read(relativePath) {
    if (relativePath === 'smart-news.js') return readSmartSource();
    if (relativePath === 'server.js') return readServerSource();
    if (relativePath === 'script.js') return readReaderClientSource();
    if (relativePath === 'index.html') return readReaderHtml();
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
    const exporter = await read('ops/maintenance/export-online-ai-usage-24h.sh');

    assert.match(summarySource, /\[ONLINE AI\]/);
    assert.match(exporter, /--since='24 hours ago'/);
    assert.match(exporter, /online-ai-usage-last-24h\.log/);
});

test('Gemini summaries use 3.8 and the removed clustering-model plumbing stays removed', async () => {
    const summarySource = await read('summary-engine.js');
    const smartSource = await read('smart-news.js');
    const serverSource = await read('server.js');
    const frontendSource = await read('script.js');

    assert.match(summarySource, /GEMINI_PRIMARY_MODEL[^\n]+gemini-3\.8-flash/);
    assert.doesNotMatch(summarySource, /gemini-3\.5-flash-lite/);
    assert.doesNotMatch(smartSource, /LITE_ESCALATION_REQUIRED|thinkingLevel|id: 'gemini-flash-lite'/);
    assert.doesNotMatch(serverSource, /DEFAULT_CLUSTERING_MODEL|SMART_CLUSTERING_MODEL|clusteringModel/);
    assert.doesNotMatch(frontendSource, /clusteringModel/);
});

test('authenticated frontend usage API exposes the detailed 24-hour report', async () => {
    const serverSource = await read('server.js');
    assert.match(serverSource, /app\.get\('\/api\/online-ai-usage', authMiddleware/);
    assert.match(serverSource, /parseOnlineAiUsageLog/);
    assert.match(serverSource, /--since=24 hours ago/);
});

test('authenticated key addition validates, privately persists, and activates a key', async () => {
    const serverSource = await read('server.js');
    const frontendSource = await read('script.js');
    assert.match(serverSource, /app\.post\('\/api\/gemini-keys', authMiddleware/);
    assert.match(serverSource, /validateGeminiKey/);
    assert.match(serverSource, /mode: 0o600/);
    assert.match(serverSource, /geminiKeyManager\.addKey\(apiKey, \{ activate: true \}\)/);
    assert.match(frontendSource, /async addGeminiKey\(\)/);
});

test('light-mode AI activity uses readable labels and high-contrast styling', async () => {
    const html = await read('index.html');
    assert.match(html, /ai-status-debug ai-status-usage/);
    assert.match(html, /Validate active key/);
    assert.match(html, /Validate & add/);
    assert.match(html, /Full detail/);
    assert.match(html, /Earlier text log/);
    assert.match(html, /\.theme-glass-light \.ai-status-modal \.ai-status-usage \[class\*="text-red-"\]/);
    assert.doesNotMatch(html, /x-text="event\.precision"/);
    assert.doesNotMatch(html, /Record source:/);
});
