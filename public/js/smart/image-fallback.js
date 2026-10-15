// Resolve the next candidate from the currently assigned source, so a reused
// card cannot inherit a failure count from an unrelated primary image.
const ReaderStoryImageFallback = {
    next(app, event, article) {
        const img = event.target;
        if (!img || img.isConnected === false) return;
        const absolute = value => {
            try { return new URL(value, img.ownerDocument?.baseURI || 'http://localhost/').href; }
            catch { return String(value); }
        };
        const candidates = [...new Set((app.usesTopStories
            ? [article.image, ...(article.imageCandidates || []), article.feedIcon, '/public/default.jpg']
            : [article.image, '/public/default.jpg']).filter(Boolean).map(value => app.proxyImageUrl(value)))];
        const current = absolute(img.getAttribute?.('src') || img.src);
        // A responsive image may still report the old decoded selection while
        // its new request is pending. That old error does not own this source.
        if (img.currentSrc && absolute(img.currentSrc) !== current && !img.complete) return;
        const index = candidates.findIndex(value => absolute(value) === current);
        const next = index >= 0 ? candidates[index + 1] : !app.usesTopStories ? candidates.at(-1) : null;
        if (next && absolute(next) !== current) img.src = next;
    }
};
