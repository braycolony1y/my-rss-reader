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

test('summaries use 3.7 while clustering uses the cost-saving Lite-to-3.7 chain', async () => {
    const summarySource = await read('summary-engine.js');
    const smartSource = await read('smart-news.js');
    const serverSource = await read('server.js');
    const frontendSource = await read('script.js');

    assert.match(summarySource, /GEMINI_PRIMARY_MODEL[^\n]+gemini-3\.7-flash/);
    assert.match(smartSource, /process\.env\.GEMINI_MODEL\s*\|\|\s*\n\s*'gemini-3\.7-flash'/);
    assert.doesNotMatch(summarySource, /gemini-3\.5-flash-lite/);
    assert.match(smartSource, /gemini-3\.5-flash-lite/);
    assert.ok(
        smartSource.indexOf("id: 'gemini-flash-lite'") < smartSource.indexOf("id: 'gemini-flash'"),
        'Flash-Lite must precede Gemini 3.7 in the provider chain'
    );
    assert.match(smartSource, /thinkingLevel:\s*'minimal'/);
    assert.match(smartSource, /thinkingLevel:\s*'low'/);
    assert.match(smartSource, /LITE_ESCALATION_REQUIRED/);
    assert.match(serverSource, /DEFAULT_CLUSTERING_MODEL/);
    assert.match(serverSource, /SMART_CLUSTERING_MODEL/);
    assert.match(frontendSource, /clusteringModel:\s*'gemini-3\.5-flash-lite'/);
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
