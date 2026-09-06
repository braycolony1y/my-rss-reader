export function createArticleProgress() {
    const articleFetchProgress = new Map();

    const articleReaderSessions = new Map();

    function updateArticleFetchProgress(requestId, stage, message, extra = {}) {
        if (!requestId) return;
        articleFetchProgress.set(requestId, {
            stage,
            message,
            ...extra,
            updatedAt: new Date().toISOString()
        });
    }

    function finishArticleFetchProgress(requestId, message, extra = {}) {
        updateArticleFetchProgress(requestId, 'complete', message, { ...extra, done: true });
        const cleanup = setTimeout(() => articleFetchProgress.delete(requestId), 2 * 60 * 1000);
        if (cleanup.unref) cleanup.unref();
    }

    // --- ARTICLE CONTENT EXTRACTION ENDPOINT ---
    let activeForegroundRequests = 0;

    return {
        articleReaderSessions,
        updateArticleFetchProgress,
        finishArticleFetchProgress,
        get activeForegroundRequests() { return activeForegroundRequests; },
        set activeForegroundRequests(value) { activeForegroundRequests = value; },
        articleFetchProgress
    };
}
