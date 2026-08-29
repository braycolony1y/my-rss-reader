const MAX_ERROR_LENGTH = 1200;

function text(value, maximum = 160) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maximum);
}

function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function journalTimestamp(value) {
    const normalized = String(value || '').replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
    const timestamp = new Date(normalized);
    return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
}

function parseJournalLine(line) {
    const match = String(line || '').match(/^(\S+)\s+\S+\s+[^:]+:\s+(.+)$/);
    if (!match) return null;
    return { timestamp: journalTimestamp(match[1]), message: match[2] };
}

function statusCodeFrom(message) {
    const match = String(message || '').match(/HTTP\s+(\d{3})|\((\d{3})\)/i);
    return match ? Number(match[1] || match[2]) : null;
}

function errorCodeFrom(message, httpStatus) {
    const value = String(message || '');
    if (httpStatus) return `HTTP_${httpStatus}`;
    if (/no .*api key|cooling down|not configured/i.test(value)) return 'NOT_CONFIGURED';
    if (/abort|timeout/i.test(value)) return 'TIMEOUT';
    if (/invalid json/i.test(value)) return 'INVALID_JSON';
    return 'ERROR';
}

function structuredEvent(parsedLine, payload, sequence) {
    const timestamp = journalTimestamp(payload.at) || parsedLine.timestamp;
    return {
        id: `online-ai-${sequence}`,
        timestamp,
        provider: text(payload.provider || 'gemini', 60).toLowerCase(),
        providerId: text(payload.providerId, 100) || null,
        operation: text(payload.operation || 'unknown', 100),
        model: text(payload.model || 'unknown', 120),
        status: payload.status === 'success' ? 'success' : 'failed',
        httpStatus: number(payload.httpStatus),
        errorCode: text(payload.errorCode, 100) || null,
        error: text(payload.error, MAX_ERROR_LENGTH) || null,
        keyIndex: number(payload.keyIndex),
        attempt: number(payload.attempt),
        durationMs: number(payload.durationMs),
        promptTokens: number(payload.promptTokens) || 0,
        outputTokens: number(payload.outputTokens) || 0,
        totalTokens: number(payload.totalTokens) || 0,
        articleCount: number(payload.articleCount),
        groupId: text(payload.groupId, 160) || null,
        source: 'structured',
        precision: 'exact',
        kind: 'request',
        isRequest: true
    };
}

function legacySmartEvent(parsedLine, message, sequence) {
    const failed = message.match(/^\[SMART VERIFY\]\s+(\S+)\s+model=(\S+)\s+failed:\s+(.+)$/i);
    if (!failed) return null;

    const providerId = text(failed[1], 100);
    if (providerId === 'local-qwen') return null;

    const error = text(failed[3], MAX_ERROR_LENGTH);
    const httpStatus = statusCodeFrom(error);
    return {
        id: `online-ai-${sequence}`,
        timestamp: parsedLine.timestamp,
        provider: providerId.startsWith('qwen') ? 'qwen-cloud' : 'gemini',
        providerId,
        operation: 'smart-clustering',
        model: text(failed[2], 120),
        status: 'failed',
        httpStatus,
        errorCode: errorCodeFrom(error, httpStatus),
        error,
        keyIndex: null,
        attempt: null,
        durationMs: null,
        promptTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        articleCount: null,
        groupId: null,
        source: 'legacy',
        precision: 'legacy',
        kind: 'request',
        isRequest: true
    };
}

function legacySummaryEvent(parsedLine, message, sequence) {
    const match = message.match(/^\[SUMMARY\]\s+(.+)$/i);
    if (!match) return null;

    const detail = text(match[1], MAX_ERROR_LENGTH);
    if (!/(gemini|qwen)/i.test(detail)) return null;

    const provider = /qwen/i.test(detail) ? 'qwen-cloud' : 'gemini';
    const httpStatus = statusCodeFrom(detail);
    const isBlocked = /all configured keys are cooling down/i.test(detail);
    const isRequest = !isBlocked && /(quota hit|api error)/i.test(detail);
    const keyMatch = detail.match(/key index\s+(\d+)/i);
    const failed = /(quota|error|fail|cooling|timeout)/i.test(detail);

    return {
        id: `online-ai-${sequence}`,
        timestamp: parsedLine.timestamp,
        provider,
        providerId: null,
        operation: 'summary',
        model: null,
        status: isBlocked ? 'blocked' : (failed ? 'failed' : 'info'),
        httpStatus,
        errorCode: failed ? errorCodeFrom(detail, httpStatus) : null,
        error: failed ? detail : null,
        message: detail,
        keyIndex: keyMatch ? Number(keyMatch[1]) + 1 : null,
        attempt: null,
        durationMs: null,
        promptTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        articleCount: null,
        groupId: null,
        source: 'legacy',
        precision: 'legacy',
        kind: isRequest ? 'request' : 'diagnostic',
        isRequest
    };
}

function percentile(values, fraction) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function breakdown(events, property) {
    const groups = new Map();
    for (const event of events) {
        const name = text(event[property] || 'unknown', 120);
        const current = groups.get(name) || { name, total: 0, success: 0, failed: 0, blocked: 0, tokens: 0 };
        current.total += 1;
        if (event.status === 'success') current.success += 1;
        if (event.status === 'failed') current.failed += 1;
        if (event.status === 'blocked') current.blocked += 1;
        current.tokens += Number(event.totalTokens) || 0;
        groups.set(name, current);
    }
    return [...groups.values()].sort((left, right) => right.total - left.total || left.name.localeCompare(right.name));
}

function summarize(events) {
    const requests = events.filter(event => event.isRequest);
    const successes = requests.filter(event => event.status === 'success');
    const failures = requests.filter(event => event.status === 'failed');
    const durations = requests.map(event => event.durationMs).filter(Number.isFinite);
    const tokens = requests.reduce((totals, event) => ({
        prompt: totals.prompt + (Number(event.promptTokens) || 0),
        output: totals.output + (Number(event.outputTokens) || 0),
        total: totals.total + (Number(event.totalTokens) || 0)
    }), { prompt: 0, output: 0, total: 0 });

    return {
        totalRequests: requests.length,
        successful: successes.length,
        failed: failures.length,
        blocked: events.filter(event => event.status === 'blocked').length,
        diagnostics: events.filter(event => !event.isRequest).length,
        exactRequests: requests.filter(event => event.precision === 'exact').length,
        legacyRequests: requests.filter(event => event.precision === 'legacy').length,
        successRate: requests.length ? Number(((successes.length / requests.length) * 100).toFixed(1)) : 0,
        averageDurationMs: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : null,
        p95DurationMs: percentile(durations, 0.95),
        promptTokens: tokens.prompt,
        outputTokens: tokens.output,
        totalTokens: tokens.total,
        httpStatuses: breakdown(failures.filter(event => event.httpStatus), 'httpStatus'),
        providers: breakdown(requests, 'provider'),
        models: breakdown(requests, 'model'),
        operations: breakdown(requests, 'operation'),
        keys: breakdown(requests.filter(event => event.keyIndex), 'keyIndex')
    };
}

export function parseOnlineAiUsageLog(rawLog, options = {}) {
    const limit = Math.max(1, Math.min(5000, Number(options.limit) || 500));
    const requestedOffset = Math.max(0, Number(options.offset) || 0);
    const events = [];
    const recentStructuredFailures = new Map();
    let sequence = 0;

    for (const line of String(rawLog || '').split(/\r?\n/)) {
        const parsedLine = parseJournalLine(line);
        if (!parsedLine?.timestamp) continue;
        const marker = parsedLine.message.indexOf('[ONLINE AI]');

        if (marker >= 0) {
            const serialized = parsedLine.message.slice(marker + '[ONLINE AI]'.length).trim();
            try {
                const event = structuredEvent(parsedLine, JSON.parse(serialized), ++sequence);
                events.push(event);
                if (event.status === 'failed') {
                    recentStructuredFailures.set(`${event.providerId || ''}|${event.model || ''}`, new Date(event.timestamp).getTime());
                }
            } catch {
                // Ignore incomplete journal lines instead of exposing unparsed text.
            }
            continue;
        }

        const smartEvent = legacySmartEvent(parsedLine, parsedLine.message, ++sequence);
        if (smartEvent) {
            const duplicateAt = recentStructuredFailures.get(`${smartEvent.providerId || ''}|${smartEvent.model || ''}`);
            const eventAt = new Date(smartEvent.timestamp).getTime();
            if (!duplicateAt || Math.abs(eventAt - duplicateAt) > 5000) events.push(smartEvent);
            continue;
        }

        const summaryEvent = legacySummaryEvent(parsedLine, parsedLine.message, ++sequence);
        if (summaryEvent) events.push(summaryEvent);
    }

    events.sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp));
    const offset = Math.min(requestedOffset, Math.max(0, events.length - 1));
    const page = events.slice(offset, offset + limit);
    const requestEvents = events.filter(event => event.isRequest);
    const timestamps = events.map(event => new Date(event.timestamp).getTime()).filter(Number.isFinite);

    return {
        generatedAt: new Date().toISOString(),
        windowHours: 24,
        coverage: {
            firstEventAt: timestamps.length ? new Date(Math.min(...timestamps)).toISOString() : null,
            lastEventAt: timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null,
            detailedRequestCount: requestEvents.filter(event => event.precision === 'exact').length,
            legacyRequestCount: requestEvents.filter(event => event.precision === 'legacy').length,
            note: 'Exact token, latency, key and attempt fields are available for structured events. Earlier legacy events retain every detail present in the historical journal.'
        },
        summary: summarize(events),
        filters: {
            providers: [...new Set(events.map(event => event.provider).filter(Boolean))].sort(),
            models: [...new Set(events.map(event => event.model).filter(Boolean))].sort(),
            operations: [...new Set(events.map(event => event.operation).filter(Boolean))].sort(),
            statuses: [...new Set(events.map(event => event.status).filter(Boolean))].sort()
        },
        totalEvents: events.length,
        offset,
        returnedEvents: page.length,
        rangeStart: page.length ? offset + 1 : 0,
        rangeEnd: page.length ? offset + page.length : 0,
        hasNewer: offset > 0,
        hasOlder: offset + page.length < events.length,
        truncated: events.length > page.length,
        events: page
    };
}
