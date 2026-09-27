const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const center = { x: 0.5, y: 0.5 };

// CSS percentages align the same percentage of image and box; they are not
// source coordinates. Solve the cover crop in pixels, then convert back.
export function coverPosition(imageWidth, imageHeight, boxWidth, boxHeight, focus = center, targetX = 0.62) {
    if (![imageWidth, imageHeight, boxWidth, boxHeight].every(n => Number.isFinite(n) && n > 0)) return { x: 50, y: 50 };
    const scale = Math.max(boxWidth / imageWidth, boxHeight / imageHeight);
    function axis(source, box, point, target, start, end) {
        const rendered = source * scale;
        const overflow = rendered - box;
        if (overflow < 0.01) return 50;
        let offset = clamp(box * target - rendered * point, -overflow, 0);
        // Keep the whole face, with a little breathing room, whenever it fits.
        if (Number.isFinite(start) && Number.isFinite(end)) {
            const margin = box * 0.04;
            const low = Math.max(-overflow, margin - start * rendered);
            const high = Math.min(0, box - margin - end * rendered);
            if (low <= high) offset = clamp(offset, low, high);
        }
        return clamp(-offset / overflow) * 100;
    }
    const x = Number.isFinite(focus?.x) ? clamp(focus.x) : 0.5;
    const y = Number.isFinite(focus?.y) ? clamp(focus.y) : 0.5;
    return {
        x: axis(imageWidth, boxWidth, x, targetX, focus?.bounds?.left, focus?.bounds?.right),
        y: axis(imageHeight, boxHeight, y, 0.46, focus?.bounds?.top, focus?.bounds?.bottom)
    };
}

export function installImageFocus(win) {
    const doc = win.document;
    const selector = '.article-card-image img.thumbnail-img';
    const storageKey = 'rss-image-focus-v1';
    const states = new Map();
    const cache = new Map();
    const saved = new Map();
    const queue = [];
    let active = 0;
    let stopped = false;
    doc.documentElement.dataset.imageFocus = 'active';
    try {
        for (const [source, focus] of JSON.parse(win.sessionStorage.getItem(storageKey) || '[]')) {
            if (Number.isFinite(focus?.x) && Number.isFinite(focus?.y)) saved.set(source, focus);
        }
    } catch { /* Storage is optional, including in private browsing. */ }

    function drain() {
        while (active < 2 && queue.length) {
            const { source, resolve } = queue.shift();
            if (![...states.values()].some(state => state.source === source)) {
                cache.delete(source);
                resolve(center);
                continue;
            }
            active++;
            const controller = new win.AbortController();
            const timer = win.setTimeout(() => controller.abort(), 30_000);
            win.fetch(`/api/image-focus?src=${encodeURIComponent(source)}`, { signal: controller.signal })
                .then(response => response.ok ? response.json() : null)
                .then(result => {
                    if (!result || result.retry) cache.delete(source);
                    else {
                        saved.set(source, result);
                        if (saved.size > 300) saved.delete(saved.keys().next().value);
                        try { win.sessionStorage.setItem(storageKey, JSON.stringify([...saved])); } catch { }
                    }
                    resolve(result || center);
                }, () => { cache.delete(source); resolve(center); })
                .finally(() => { win.clearTimeout(timer); active--; if (!stopped) drain(); });
        }
    }

    function getFocus(source) {
        if (saved.has(source)) return Promise.resolve(saved.get(source));
        if (cache.has(source)) return cache.get(source);
        const promise = new Promise(resolve => { queue.push({ source, resolve }); });
        cache.set(source, promise);
        if (cache.size > 500) cache.delete(cache.keys().next().value);
        drain();
        return promise;
    }

    function sourceOf(img) {
        if (!img.getAttribute('src')) return '';
        const url = new URL(img.complete && img.naturalWidth ? (img.currentSrc || img.src) : img.src, win.location.href);
        return url.origin === win.location.origin ? url.pathname + url.search : url.href;
    }

    function onScreen(img) {
        const rect = img.getBoundingClientRect();
        const scroll = img.closest('#scroll-container')?.getBoundingClientRect();
        const top = Math.max(0, scroll?.top || 0);
        const bottom = Math.min(win.innerHeight, scroll?.bottom || win.innerHeight);
        return rect.bottom > top && rect.top < bottom && rect.right > 0 && rect.left < win.innerWidth;
    }

    function fitViewport(img) {
        const card = img.closest('.article-card');
        const viewport = img.parentElement;
        const heading = card?.querySelector('.article-card-heading');
        if (card?.dataset.imageLayout !== 'top' || !heading) {
            viewport.style.removeProperty('--image-focus-height');
            return;
        }
        const cardRect = card.getBoundingClientRect();
        let bottom = heading.getBoundingClientRect().bottom + 8;
        // Facts, notices and analysis are opaque content, not usable photo area.
        for (const panel of card.querySelectorAll('.article-briefing > *')) {
            const rect = panel.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) bottom = Math.min(bottom, rect.top - 8);
        }
        const height = `${Math.max(1, Math.min(card.clientHeight, bottom - cardRect.top)).toFixed(2)}px`;
        if (viewport.style.getPropertyValue('--image-focus-height') !== height) viewport.style.setProperty('--image-focus-height', height);
    }

    function apply(img, state) {
        fitViewport(img);
        if (!img.complete || !img.naturalWidth || !img.clientWidth || !img.clientHeight) return;
        const target = parseFloat(win.getComputedStyle(img).getPropertyValue('--image-focus-target')) || 0.62;
        const scale = Math.max(img.clientWidth / img.naturalWidth, img.clientHeight / img.naturalHeight);
        const bounds = state.focus.bounds;
        // A very large face in a portrait cannot fit a shallow cover crop.
        // In that case show the whole photo against the card background.
        const contain = bounds && ((bounds.right - bounds.left) * img.naturalWidth * scale > img.clientWidth * 0.92
            || (bounds.bottom - bounds.top) * img.naturalHeight * scale > img.clientHeight * 0.92);
        const position = contain ? { x: 100, y: 50 }
            : coverPosition(img.naturalWidth, img.naturalHeight, img.clientWidth, img.clientHeight, state.focus, target);
        img.style.setProperty('--image-focus-fit', contain ? 'contain' : 'cover');
        img.style.setProperty('--image-focus-x', `${position.x.toFixed(3)}%`);
        img.style.setProperty('--image-focus-y', `${position.y.toFixed(3)}%`);
        if (state.settled) {
            img.dataset.focusState = 'ready';
            state.shown = true;
        }
    }

    function update(img) {
        const state = states.get(img);
        if (!state) return;
        const source = sourceOf(img);
        if (state.source !== source) {
            win.clearTimeout(state.timer);
            Object.assign(state, { source, focus: saved.get(source) || center, settled: saved.has(source), requested: false, shown: false, deferred: null, timer: null });
            img.dataset.focusState = 'pending';
        }
        if (state.deferred && !onScreen(img)) {
            state.focus = state.deferred;
            state.deferred = null;
        }
        if (state.near) img.loading = 'eager';
        apply(img, state);
        if (!source) return;
        if (state.near && !state.settled && !state.timer) {
            // Slow/offline detection must not leave a blank photo indefinitely.
            // Once this fallback is visible, don't move it under the reader.
            state.timer = win.setTimeout(() => {
                if (states.get(img) !== state || state.source !== source) return;
                state.settled = true;
                apply(img, state);
            }, 2500);
        }
        if (state.requested) return;
        state.requested = true;
        if (source.startsWith('/public/') || source.startsWith('data:') || source.startsWith('blob:')) {
            state.settled = true;
            win.clearTimeout(state.timer);
            apply(img, state);
            return;
        }
        // Start for every rendered card, even while its lazy image is unloaded.
        getFocus(source).then(focus => {
            if (stopped || !img.isConnected || states.get(img) !== state || state.source !== source || sourceOf(img) !== source) return;
            win.clearTimeout(state.timer);
            if (state.shown && onScreen(img)) state.deferred = focus;
            else state.focus = focus;
            state.settled = true;
            apply(img, state);
        });
    }

    const resize = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(entries => {
        const images = new Set(entries.map(({ target }) => target.matches(selector) ? target : target.closest('.article-card')?.querySelector(selector)));
        images.forEach(img => { if (img) update(img); });
    }) : null;
    const nearby = typeof win.IntersectionObserver === 'function' ? new win.IntersectionObserver(entries => {
        for (const entry of entries) {
            const state = states.get(entry.target);
            if (state) { state.near = entry.isIntersecting; update(entry.target); }
        }
    }, { rootMargin: '1600px 0px' }) : null;
    const visibility = typeof win.IntersectionObserver === 'function' ? new win.IntersectionObserver(entries => {
        for (const entry of entries) if (!entry.isIntersecting) update(entry.target);
    }) : null;

    function watch(img) {
        if (states.has(img) || !img.matches?.(selector)) return;
        const card = img.closest('.article-card');
        const observed = [img, card, card?.querySelector('.article-card-heading'), card?.querySelector('.article-briefing')].filter(Boolean);
        states.set(img, { focus: center, near: !nearby, requested: false, observed });
        observed.forEach(el => resize?.observe(el));
        nearby?.observe(img);
        visibility?.observe(img);
        update(img);
    }
    function scan(node) {
        if (node.nodeType !== 1) return;
        watch(node);
        node.querySelectorAll(selector).forEach(watch);
    }
    const onLoad = event => { if (event.target.matches?.(selector)) { watch(event.target); update(event.target); } };
    const onResize = () => { for (const img of states.keys()) update(img); };
    const mutations = new win.MutationObserver(records => {
        const affected = new Set();
        for (const record of records) {
            if (record.type === 'attributes' && record.target.matches(selector)) {
                if (record.attributeName === 'src' || record.attributeName === 'srcset') {
                    const state = states.get(record.target);
                    if (state) state.source = null;
                    watch(record.target);
                    affected.add(record.target);
                }
            } else if (!record.target.matches?.('.article-card-image')) {
                const img = record.target.closest?.('.article-card')?.querySelector(selector);
                if (img) affected.add(img);
            }
            record.addedNodes.forEach(scan);
        }
        affected.forEach(update);
        for (const [img, state] of states) {
            if (!img.isConnected) {
                win.clearTimeout(state.timer);
                state.observed.forEach(el => resize?.unobserve(el));
                nearby?.unobserve(img); visibility?.unobserve(img); states.delete(img);
            }
        }
    });
    mutations.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcset', 'class', 'style', 'data-image-layout'] });
    doc.addEventListener('load', onLoad, true);
    win.addEventListener('resize', onResize);
    scan(doc.body);
    return () => {
        stopped = true;
        mutations.disconnect(); resize?.disconnect(); nearby?.disconnect(); visibility?.disconnect();
        doc.removeEventListener('load', onLoad, true); win.removeEventListener('resize', onResize);
        for (const state of states.values()) win.clearTimeout(state.timer);
        states.clear(); cache.clear();
        queue.splice(0).forEach(job => job.resolve(center));
        delete doc.documentElement.dataset.imageFocus;
    };
}

if (typeof window !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => installImageFocus(window), { once: true });
    else installImageFocus(window);
}
