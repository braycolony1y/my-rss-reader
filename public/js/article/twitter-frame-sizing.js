// Direct X embeds report their content size even when widgets.js is unavailable.
// Keep one document-level listener; removed reader frames are never retained.
const ReaderTwitterFrameSizing = (() => {
    const installed = new WeakSet();

    function install(view) {
        if (installed.has(view)) return;
        installed.add(view);
        view.addEventListener('message', event => {
            if (event.origin !== 'https://platform.twitter.com') return;
            const message = event.data?.['twttr.embed'];
            if (message?.method !== 'twttr.private.resize') return;
            const size = message.params?.[0];
            if (typeof size?.height !== 'number' || !Number.isFinite(size.height)
                || size.height <= 0 || size.height > 100000) return;

            for (const frame of view.document.querySelectorAll('.voz-twitter-embed > iframe.voz-twitter-embed__fallback')) {
                if (frame.contentWindow !== event.source) continue;
                const url = new URL(frame.src, view.location.href);
                const tweetId = frame.parentElement.dataset.tweetId;
                if (url.origin !== event.origin || url.pathname !== '/embed/Tweet.html'
                    || !tweetId || url.searchParams.get('id') !== tweetId
                    || size.data?.tweet_id !== tweetId) return;
                // Override the initial desktop/mobile reserve without clipping
                // long posts or imposing a second scrolling area.
                frame.style.setProperty('height', `${Math.ceil(size.height)}px`, 'important');
                return;
            }
        });
    }

    return { install };
})();
