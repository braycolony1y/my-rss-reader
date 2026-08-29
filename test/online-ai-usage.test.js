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
