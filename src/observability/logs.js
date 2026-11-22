export function captureOperationalLogs() {
    // ============================================================================
    // 📋 IN-MEMORY LOG BUFFER & FETCH HISTORY (24h retention)
    // ============================================================================

    const MAX_LOG_AGE_MS = 24 * 60 * 60 * 1000;

    // 24 hours
    const systemLogs = [];

    // { timestamp, level, message }
    const fetchHistory = [];

    // { timestamp, feedUrl, feedTitle, status, details, durationMs }

    function pruneOldEntries(arr) {
        const cutoff = Date.now() - MAX_LOG_AGE_MS;
        while (arr.length > 0 && arr[0].timestamp < cutoff) arr.shift();
        if (arr.length > 5000) arr.splice(0, arr.length - 3000);
    }

    // Intercept console.log/error to capture into the ring buffer
    const _origLog = console.log.bind(console);

    const _origError = console.error.bind(console);

    console.log = (...args) => {
        _origLog(...args);
        const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
        systemLogs.push({ timestamp: Date.now(), level: 'info', message: msg });
        if (systemLogs.length > 5000) pruneOldEntries(systemLogs);
    };

    console.error = (...args) => {
        _origError(...args);
        const msg = args.map(a => typeof a === 'string' ? a : (a instanceof Error ? a.message : JSON.stringify(a))).join(' ');
        systemLogs.push({ timestamp: Date.now(), level: 'error', message: msg });
        if (systemLogs.length > 5000) pruneOldEntries(systemLogs);
    };

    function recordFetch(feedUrl, feedTitle, status, details = '', durationMs = 0, extra = {}) {
        const entry = { timestamp: Date.now(), feedUrl, feedTitle, status, details, durationMs };
        // Attach extra context for error entries (httpStatus, responseSnippet, etc.)
        if (status === 'error' && extra) {
            if (extra.httpStatus) entry.httpStatus = extra.httpStatus;
            if (extra.responseSnippet) entry.responseSnippet = extra.responseSnippet;
            if (extra.errorType) entry.errorType = extra.errorType;
        }
        fetchHistory.push(entry);
        if (fetchHistory.length > 5000) pruneOldEntries(fetchHistory);
    }

    return {
        recordFetch,
        fetchHistory,
        pruneOldEntries,
        systemLogs
    };
}
