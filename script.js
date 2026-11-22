// The server supplies synchronous feature modules before this entry point.
// Keep this classic script at the end of body, before deferred Alpine starts.
function rssApp() {
    return ReaderComponent.compose([
        ReaderUiLayout.create,
        ReaderFeedsManagement.create,
        ReaderAppBootstrap.create,
        ReaderFeedsNavigation.create,
        ReaderFeedsList.create,
        ReaderSmartTopStories.create,
        ReaderSmartNavigation.create,
        ReaderAppServerEvents.create,
        ReaderFeedsReadingState.create,
        ReaderAppPersistence.create,
        ReaderBoardCache.create,
        ReaderArticlePresentation.create,
        ReaderFeedsContentFilter.create,
        ReaderAiStatus.create,
        ReaderSmartSources.create,
        ReaderUiDiagnostics.create,
        ReaderSmartFeedback.create,
        ReaderFilterLog.create,
        ReaderBoardFolders.create,
        ReaderArticleOverlay.create,
        ReaderArticleExport.create,
        ReaderArticleSpeech.create,
        ReaderArticleSummary.create,
        ReaderSourcesVozThread.create,
        ReaderUiTooltips.create,
        ReaderArticleEmbeds.create,
        ReaderArticleNavigation.create,
        ReaderArticlePrefetch.create
    ]);
}

// Preserve the original listener and lease installation order.
ReaderTinhte.installComparison();
ReaderGroundNews.install();
ReaderTinhte.installNavigation();
ReaderBoardView.install();
ReaderSmartFocus.install();
ReaderSmartViewport.install();
ReaderVozLease.install();
