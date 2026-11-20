import assert from 'node:assert/strict';
import test from 'node:test';

import { parseOnlineAiUsageLog } from '../src/online-ai-usage.js';

const fixture = `RSS Reader online AI usage — rolling 24-hour window
Generated: 2026-08-29 08:10:00 +07
Source: rss-reader.service journal

2026-08-29T08:00:00+0700 host node[1]: [ONLINE AI] {"at":"2026-08-29T01:00:00.000Z","provider":"gemini","operation":"article-summary","model":"gemini-3.7-flash","keyIndex":7,"status":"success","httpStatus":200,"durationMs":1500,"promptTokens":100,"outputTokens":20,"totalTokens":120}
2026-08-29T08:01:00+0700 host node[1]: [ONLINE AI] {"at":"2026-08-29T01:01:00.000Z","provider":"gemini","operation":"smart-clustering","providerId":"gemini-flash","model":"gemini-3.7-flash","status":"failed","httpStatus":503,"errorCode":"HTTP_503","error":"High demand","attempt":1,"durationMs":800,"articleCount":4}
2026-08-29T08:01:01+0700 host node[1]: [SMART VERIFY] gemini-flash model=gemini-3.7-flash failed: Gemini HTTP 503: high demand
2026-08-29T08:02:00+0700 host node[1]: [SUMMARY] Gemini API quota hit (429). All configured keys are cooling down.
2026-08-29T08:03:00+0700 host node[1]: [SMART VERIFY] qwen-flash model=qwen3.7-flash failed: Qwen HTTP 403: denied
2026-08-29T08:04:00+0700 host node[1]: [SMART VERIFY] local-qwen model=qwen3.5:2b failed: Local AI HTTP 404: missing
`;

test('parses detailed structured and historical online AI events', () => {
    const report = parseOnlineAiUsageLog(fixture, { limit: 100 });

    assert.equal(report.summary.totalRequests, 3);
    assert.equal(report.summary.successful, 1);
    assert.equal(report.summary.failed, 2);
    assert.equal(report.summary.blocked, 1);
    assert.equal(report.summary.totalTokens, 120);
    assert.equal(report.summary.averageDurationMs, 1150);
    assert.equal(report.events.some(event => event.providerId === 'local-qwen'), false);
    assert.equal(report.events.filter(event => event.model === 'gemini-3.7-flash').length, 2);
    assert.equal(report.events.find(event => event.keyIndex === 7)?.promptTokens, 100);
    assert.equal(report.events.find(event => event.provider === 'qwen-cloud')?.httpStatus, 403);
});

test('limits returned events while summarizing the complete window', () => {
    const report = parseOnlineAiUsageLog(fixture, { limit: 2 });
    assert.equal(report.returnedEvents, 2);
    assert.equal(report.truncated, true);
    assert.equal(report.summary.totalRequests, 3);
});

test('paginates through every event in the 24-hour window', () => {
    const report = parseOnlineAiUsageLog(fixture, { limit: 2, offset: 2 });
    assert.equal(report.offset, 2);
    assert.equal(report.rangeStart, 3);
    assert.equal(report.hasNewer, true);
    assert.equal(report.summary.totalRequests, 3);
    assert.notEqual(report.events[0]?.id, parseOnlineAiUsageLog(fixture, { limit: 2 }).events[0]?.id);
});

test('online AI usage keeps the browser auto-restart trail from structured events', async () => {
    const { parseOnlineAiUsageLog } = await import('../src/online-ai-usage.js');
    const payload = {
        at: '2026-11-20T01:00:00.000Z', provider: 'gemini-web', operation: 'story-briefing', model: '3.8 Flash',
        status: 'failed', errorCode: 'BROWSER_CONNECT', error: 'Browser profile "xkxs7k9w" is not connected',
        recovery: { profile: 'xkxs7k9w', restarts: 1, attempts: [{ n: 1, action: 'restart', outcome: 'connected', durationMs: 4100, removedLocks: ['SingletonLock'], killedPids: [] }] }
    };
    const log = `2026-11-20T08:00:00+0700 host node[1]: [ONLINE AI] ${JSON.stringify(payload)}\n`;
    const parsed = parseOnlineAiUsageLog(log);
    const event = (parsed.events || parsed)[0];
    assert.equal(event.recovery.restarts, 1);
    assert.equal(event.recovery.attempts[0].outcome, 'connected');
    assert.match(event.recovery.summary, /#1 restart:connected 4100ms/);
});

test('online AI usage keeps model, thinking level and fallback details for success and failed events', async () => {
    const { parseOnlineAiUsageLog } = await import('../src/online-ai-usage.js');
    const base = { provider: 'gemini-web', operation: 'story-briefing', model: 'Quick answers', slot: 2,
        thinkingLevel: 'low', modelFallback: true, thinkingFallback: true, requestedModel: 'Everyday help' };
    const lines = [
        { ...base, at: '2026-11-20T01:00:00.000Z', status: 'success' },
        { ...base, at: '2026-11-20T01:01:00.000Z', status: 'failed', errorCode: 'X', error: 'high demand (503 UNAVAILABLE)' }
    ].map(payload => `2026-11-20T08:0${payload.status === 'success' ? 0 : 1}:00+0700 host node[1]: [ONLINE AI] ${JSON.stringify(payload)}`).join('\n');
    const events = parseOnlineAiUsageLog(lines).events;
    assert.equal(events.length, 2);
    for (const event of events) {
        assert.equal(event.model, 'Quick answers');
        assert.equal(event.thinkingLevel, 'low');
        assert.equal(event.modelFallback, true);
        assert.equal(event.thinkingFallback, true);
        assert.equal(event.requestedModel, 'Everyday help');
        assert.equal(event.slot, 2);
    }
    assert.equal(events.find(event => event.status === 'failed').error, 'high demand (503 UNAVAILABLE)');
});

test('AI usage card shows model, thinking, fallback badge and restart trail outside Technical details', async () => {
    const { readFileSync } = await import('node:fs');
    const html = readFileSync(new URL('../public/components/modals/ai-status.html', import.meta.url), 'utf8');
    const details = html.indexOf('Technical details');
    for (const marker of ['ai-usage-fallback', 'ai-usage-recovery', "event.thinkingLevel + ' thinking'"]) {
        const at = html.indexOf(marker);
        assert.ok(at > 0 && at < details, marker);
    }
});
