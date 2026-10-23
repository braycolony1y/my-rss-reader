// Scroll events only record ownership and arm a trailing checkpoint. Geometry,
// reactive preferences and storage stay out of the event callback. Lifecycle
// flushes sample the final position before the reader can change ownership.
const ReaderVozScrollPosition = (() => {
    const sessions = new WeakMap();
    const owner = app => app.vozScrollOwner || app;
    function eligible(app) {
        const url = app.overlayArticle?.link || '';
        return app.articleOverlayOpen && !app.vozResumePending
            && (url.includes('voz.vn') || app.overlayArticle?.siteName === 'VOZ');
    }
    function sample(app, container) {
        if (!eligible(app) || !container) return;
        if (typeof ReaderArticleContent !== 'undefined' && ReaderArticleContent.positionPending(container)) return;
        const posts = Array.from(container.querySelectorAll('.voz-post[data-post-index]'));
        if (!posts.length) return;
        const threshold = container.getBoundingClientRect().top - 50;
        // Posts are a vertical, ordered list. Read logarithmically rather than
        // measuring every earlier post on a deep, cached thread page.
        let low = 0, high = posts.length;
        while (low < high) {
            const middle = (low + high) >>> 1;
            if (posts[middle].getBoundingClientRect().top < threshold) low = middle + 1;
            else high = middle;
        }
        const post = posts[Math.min(low, posts.length - 1)];
        const index = post.getAttribute('data-post-index');
        const absId = post.getAttribute('data-absolute-post-id');
        if (!index) return;
        const url = app.overlayArticle.link || '';
        const match = url.match(/threads\/[^\/.]+\.(\d+)/i) || url.match(/\b(\d{5,8})\b/);
        const key = 'voz_last_read_post_' + (match ? match[1] : url);
        const value = absId ? JSON.stringify({ index, absId,
            page: app.overlayPagination?.currentPage || Math.ceil(Number(index) / 20) }) : index;
        app.syncUserPreferenceDebounced(key, value);
    }
    function flush(app) {
        const session = sessions.get(owner(app));
        if (session) clearTimeout(session.timer);
        sessions.delete(owner(app));
        sample(app, document.getElementById('overlay-scroll-container'));
    }
    function track(app, event) {
        if (!eligible(app)) return;
        const container = event.currentTarget || event.target;
        if (!container) return;
        let session = sessions.get(owner(app));
        if (session && session.request !== app.overlayRequestId) {
            clearTimeout(session.timer);
            sessions.delete(owner(app));
            session = null;
        }
        if (!session) {
            session = { request: app.overlayRequestId, firstAt: performance.now() };
            sessions.set(owner(app), session);
        }
        clearTimeout(session.timer);
        session.timer = setTimeout(() => {
            if (sessions.get(owner(app)) !== session) return;
            sessions.delete(owner(app));
            if (app.overlayRequestId === session.request) sample(app, container);
        }, Math.min(300, Math.max(0, 1000 - (performance.now() - session.firstAt))));
    }
    return { track, flush };
})();
