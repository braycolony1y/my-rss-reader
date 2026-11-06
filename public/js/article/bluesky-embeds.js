// Official Bluesky frames require a DID, while VOZ supplies a profile handle.
// Resolve through oEmbed without executing any returned scripts or markup.
const ReaderBlueskyEmbeds = (() => {
    const origin = 'https://embed.bsky.app';
    const installed = new WeakSet();
    const watched = new WeakMap();
    const started = new WeakSet();
    const selector = '.voz-bluesky-embed[data-bluesky-url]';
    let sequence = 0;

    function install(view) {
        if (installed.has(view)) return;
        installed.add(view);
        view.addEventListener('message', event => {
            if (event.origin !== origin) return;
            const { id, height } = event.data || {};
            if (typeof id !== 'string' || typeof height !== 'number'
                || !Number.isFinite(height) || height <= 0 || height > 100000) return;
            for (const frame of view.document.querySelectorAll('.voz-bluesky-embed__frame')) {
                if (frame.contentWindow !== event.source || frame.dataset.blueskyId !== id) continue;
                const url = new URL(frame.src, view.location.href);
                if (url.origin !== origin || url.searchParams.get('id') !== id) return;
                frame.style.setProperty('height', `${Math.ceil(height)}px`, 'important');
                return;
            }
        });
    }

    function hydrate(root = document, theme = 'glass-light') {
        const view = root.ownerDocument?.defaultView || window;
        install(view);
        // Alpine can replace x-html again after source-time formatting or a
        // VOZ update. Watch only the supplied reader scope and added embeds.
        let state = watched.get(root);
        if (!state) {
            state = { theme };
            const observer = new view.MutationObserver(records => {
                for (const record of records) for (const node of record.addedNodes) {
                    if (node.nodeType === 1 && (node.matches(selector) || node.querySelector(selector))) {
                        hydrateNodes(node, state.theme, view);
                    }
                }
            });
            observer.observe(root, { childList: true, subtree: true });
            state.observer = observer;
            watched.set(root, state);
        }
        state.theme = theme;
        return hydrateNodes(root, theme, view);
    }

    function hydrateNodes(root, theme, view) {
        const tasks = [];
        const embeds = [...(root.matches?.(selector) ? [root] : []), ...root.querySelectorAll(selector)];
        for (const embed of embeds) {
            if (started.has(embed) || embed.querySelector('iframe.voz-bluesky-embed__frame')) continue;
            const post = embed.dataset.blueskyUrl.match(/^https:\/\/bsky\.app\/profile\/([a-zA-Z0-9.:-]+)\/post\/([a-zA-Z0-9]{1,64})$/);
            if (!post) continue;
            started.add(embed);
            embed.dataset.blueskyState = 'loading';
            tasks.push((async () => {
                try {
                    const response = await view.fetch(`${origin}/oembed?url=${encodeURIComponent(post[0])}`, {
                        credentials: 'omit', signal: view.AbortSignal.timeout(15000)
                    });
                    if (!response.ok) throw new Error('Bluesky post unavailable');
                    const result = await response.json();
                    const parsed = new view.DOMParser().parseFromString(String(result.html || ''), 'text/html');
                    const uri = parsed.querySelector('blockquote[data-bluesky-uri]')?.getAttribute('data-bluesky-uri');
                    const identity = uri?.match(/^at:\/\/(did:plc:[a-z2-7]{24}|did:web:[a-zA-Z0-9.:%-]+)\/app\.bsky\.feed\.post\/([a-zA-Z0-9]{1,64})$/);
                    if (!identity || identity[2] !== post[2]) throw new Error('Invalid Bluesky post identity');
                    if (!embed.isConnected) return;
                    const id = `rss-bluesky-${++sequence}`;
                    const url = new URL(`${origin}/embed/${identity[1]}/app.bsky.feed.post/${identity[2]}`);
                    url.searchParams.set('id', id);
                    url.searchParams.set('colorMode', theme === 'glass-light' ? 'light' : 'dark');
                    const frame = view.document.createElement('iframe');
                    frame.className = 'voz-bluesky-embed__frame';
                    frame.dataset.blueskyId = id;
                    frame.title = 'Embedded Bluesky post';
                    frame.setAttribute('scrolling', 'no');
                    frame.setAttribute('allow', 'fullscreen; autoplay; encrypted-media; picture-in-picture');
                    frame.setAttribute('allowfullscreen', '');
                    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation');
                    frame.src = url.href;
                    embed.prepend(frame);
                    embed.dataset.blueskyState = 'ready';
                } catch {
                    embed.dataset.blueskyState = 'fallback';
                }
            })());
        }
        return Promise.all(tasks);
    }

    return { install, hydrate };
})();
