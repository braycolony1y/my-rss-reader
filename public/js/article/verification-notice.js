const ReaderPublisherVerification = {
    applyProgress(component, result, requestId) {
        if (!component.articleOverlayOpen || component.overlayRequestId !== requestId) return;
        const notice = result?.publisherVerification || component.overlayProgress?.publisherVerification;
        component.overlayProgress = { ...result, ...(notice ? { publisherVerification: notice } : {}) };
    },
    apply(component, result) {
        if (result?.publisherVerification) {
            component.overlayProgress = { ...component.overlayProgress, publisherVerification: result.publisherVerification };
        }
    },
    retry(component) {
        if (!component.overlayArticle || component.isLoadingOverlay) return;
        component.articleContentCache.delete(component.articleReaderUrl(component.overlayArticle));
        component.openArticleOverlay({ ...component.overlayArticle, isCached: false }, { bypassCache: true });
    }
};
window.ReaderPublisherVerification = ReaderPublisherVerification;
