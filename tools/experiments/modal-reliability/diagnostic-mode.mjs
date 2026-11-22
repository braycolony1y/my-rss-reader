// Serialized into the explicitly enabled loopback development server only.
// Self-contained so production entrypoints and client modules stay unchanged.
export function installDiagnosticMode({ developmentOnly = false, fixture = false } = {}) {
    if (!developmentOnly || !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) return { enabled: false };
    if (window.__flickerDiagnostic) return window.__flickerDiagnostic;
    const params = new URLSearchParams(location.search), selected = params.get('flicker') || 'baseline';
    const allowed = ['baseline', 'nobgglass', 'nobackdrop', 'nomodalblur', 'noai2poll', 'noprovider5poll', 'noactivity60poll', 'nofeedpoll'];
    if (!allowed.includes(selected)) throw Error('Unknown flicker diagnostic switch: ' + selected);
    if (fixture) document.cookie = 'auth=true; path=/; SameSite=Lax';
    const records = new Array(4096), started = performance.now();
    let cursor = 0, count = 0, nextSuppressed = -1000000, frames = 0, sampleHandle, stopped = false;
    const suppressed = new Set(), cleanups = [];
    const log = (type, detail = {}) => {
        if (stopped && type !== 'stopped-reload-required') return;
        records[cursor] = { at: performance.now(), wallTime: Date.now(), type, ...detail };
        cursor = (cursor + 1) % records.length; count = Math.min(count + 1, records.length);
    };
    const background = 'body > aside.group, body > aside.group *, body > main > header, body > main > header *';
    const targets = () => selected === 'nomodalblur' ? [...document.querySelectorAll('.ai-status-overlay')]
        : selected === 'nobgglass' ? [...document.querySelectorAll(background)] : [...document.querySelectorAll('html, body, body *')];
    const snapshot = elements => {
        const filtered = []; let visibleElements = 0, inspectedSurfaces = 0;
        for (const el of elements) {
            const rect = el.getBoundingClientRect(), normal = getComputedStyle(el);
            if (!rect.width || !rect.height || rect.bottom <= 0 || rect.right <= 0 || rect.top >= innerHeight || rect.left >= innerWidth
                || normal.display === 'none' || normal.visibility === 'hidden' || Number(normal.opacity) === 0) continue;
            visibleElements++;
            for (const pseudo of [null, '::before', '::after']) {
                const s = pseudo ? getComputedStyle(el, pseudo) : normal;
                if (pseudo && ['none', 'normal', ''].includes(s.content)) continue;
                inspectedSurfaces++;
                const row = { tag: el.tagName, class: String(el.className).slice(0, 120), pseudo,
                    filter: s.backdropFilter || s.getPropertyValue('backdrop-filter'),
                    prefixed: s.getPropertyValue('-webkit-backdrop-filter'), position: s.position };
                if ([row.filter, row.prefixed].some(v => v && v !== 'none')) filtered.push(row);
            }
        }
        return { visibleElements, inspectedSurfaces, filtered };
    };
    const nativeInterval = window.setInterval, nativeClear = window.clearInterval;
    window.setInterval = function (callback, delay, ...args) {
        const source = typeof callback === 'function' ? Function.prototype.toString.call(callback) : String(callback);
        const kind = delay === 2000 && /fetchSmartAiProgress\s*\(/.test(source) ? 'noai2poll'
            : delay === 5000 && /fetchGeminiDebugStats\s*\(/.test(source) ? 'noprovider5poll'
            : delay === 60000 && /fetchOnlineAiUsage\s*\(/.test(source) ? 'noactivity60poll' : null;
        if (kind && selected === kind) {
            const id = nextSuppressed--;
            suppressed.add(id); log('poll-suppressed', { kind, delay }); return id;
        }
        if (!kind) return nativeInterval.call(this, callback, delay, ...args);
        log('poll-registered', { kind, delay });
        return nativeInterval.call(this, function (...values) {
            log('poll-callback', { kind, delay }); return callback.apply(this, values);
        }, delay, ...args);
    };
    window.clearInterval = function (id) {
        if (!suppressed.delete(id)) return nativeClear.call(this, id);
    };
    cleanups.push(() => { window.setInterval = nativeInterval; window.clearInterval = nativeClear; });
    const originalFetch = window.fetch;
    let request = 0;
    window.fetch = function (input, options) {
        const url = new URL(typeof input === 'string' ? input : input.url, location.href);
        if (url.origin !== location.origin || !['/api/data', '/api/smart-status', '/api/summary/debug', '/api/online-ai-usage', '/api/article-content'].includes(url.pathname))
            return originalFetch.call(this, input, options);
        const id = ++request; log('request-start', { id, path: url.pathname });
        return originalFetch.call(this, input, options).then(response => {
            log('request-headers', { id, path: url.pathname, status: response.status }); return response;
        }, error => { log('request-error', { id, path: url.pathname, name: error.name }); throw error; });
    };
    cleanups.push(() => { window.fetch = originalFetch; });
    let wired = false;
    function wire() {
        if (wired || stopped || !window.Alpine || !document.body._x_dataStack) return;
        wired = true;
        const app = Alpine.$data(document.body);
        const before = snapshot(targets());
        if (['nobgglass', 'nobackdrop', 'nomodalblur'].includes(selected)) {
            const scopes = selected === 'nobgglass' ? background.split(',').map(s => s.trim())
                : selected === 'nomodalblur' ? ['.ai-status-overlay'] : ['body', 'body *', 'html'];
            const prefix = ':root:not(#__flicker_unused_a):not(#__flicker_unused_b)';
            const selectors = scopes.flatMap(s => [s, s + '::before', s + '::after'])
                .map(s => s.startsWith('html') ? prefix + s.slice(4) : `${prefix} ${s}`);
            const style = document.createElement('style');
            style.dataset.flickerDiagnostic = selected;
            style.textContent = `${selectors.join(',')} { backdrop-filter:none !important; -webkit-backdrop-filter:none !important; }`;
            document.head.append(style); cleanups.push(() => style.remove());
        }
        const after = snapshot(targets());
        log('computed-filter-check', { before, remainingFilteredTargets: after,
            passed: after.visibleElements > 0 && (!['nobgglass', 'nobackdrop', 'nomodalblur'].includes(selected) || after.filtered.length === 0) });
        for (const name of ['fetchData', 'scheduleBriefingRefresh', 'applyBriefingUpdates', 'fetchSmartAiProgress',
            'fetchGeminiDebugStats', 'fetchOnlineAiUsage', 'openGeminiStatus', 'closeGeminiStatus', 'openArticleOverlay', 'closeArticleOverlay']) {
            const original = app[name];
            if (typeof original !== 'function') continue;
            app[name] = function (...args) {
                const blocked = selected === 'nofeedpoll' && (name === 'scheduleBriefingRefresh' || name === 'applyBriefingUpdates'
                    || (name === 'fetchData' && args[0] === false && args[1] === true && args[2] === true));
                log(blocked ? 'background-update-suppressed' : 'method-start', { name,
                    caller: String(new Error().stack || '').slice(0, 1200) });
                if (blocked) return name === 'applyBriefingUpdates' ? true : name === 'fetchData' ? Promise.resolve({ diagnosticSuppressed: true }) : undefined;
                const result = original.apply(this, args);
                if (result?.then) result.then(() => log('method-complete', { name }), error => log('method-error', { name, error: error.name }));
                else log('method-complete', { name });
                return result;
            };
            cleanups.push(() => { app[name] = original; });
        }
        if (selected === 'nofeedpoll' && app.briefingRefreshTimer) {
            clearTimeout(app.briefingRefreshTimer); app.briefingRefreshTimer = null;
            log('background-timer-cleared', { name: 'briefingRefreshTimer' });
        }
        const descriptors = [
            { selector: '.ai-status-overlay', state: 'geminiStatusOpen', layers: ['.ai-status-modal'] },
            { selector: '.article-overlay-root', state: 'articleOverlayOpen', layers: ['.article-overlay-panel', '.article-overlay-backdrop'] }
        ];
        for (const descriptor of descriptors) {
            const unwatch = app.$watch(descriptor.state, value => log('open-state', { state: descriptor.state, value: !!value }));
            if (typeof unwatch === 'function') cleanups.push(unwatch);
        }
        const roots = [...document.querySelectorAll('.ai-status-overlay, .ai-status-modal, .article-overlay-root, .article-overlay-panel, .article-overlay-backdrop')];
        const watched = new Set([...roots, document.body, document.documentElement,
            document.querySelector('body > aside.group'), document.querySelector('body > main > header')]);
        const observer = new MutationObserver(entries => {
            for (const entry of entries) {
                if (entry.type === 'attributes' && watched.has(entry.target)) log('surface-attribute', {
                    tag: entry.target.tagName, attribute: entry.attributeName,
                    old: String(entry.oldValue).slice(0, 180), value: String(entry.target.getAttribute(entry.attributeName)).slice(0, 180) });
                for (const node of entry.removedNodes) if (roots.some(root => node === root || node.contains?.(root)))
                    log('surface-removed', { tag: node.nodeName });
            }
        });
        observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true,
            attributeOldValue: true, attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'] });
        cleanups.push(() => observer.disconnect());
        if (params.get('observe') === '1') {
            let lastSignature = '', lastHeartbeat = 0;
            const identities = new WeakMap(); let nextIdentity = 0;
            const layer = (node, selector) => {
                if (node && !identities.has(node)) identities.set(node, ++nextIdentity);
                const s = node && getComputedStyle(node), r = node?.getBoundingClientRect();
                return { selector, node: node ? identities.get(node) : null, connected: !!node?.isConnected,
                    display: s?.display, visibility: s?.visibility, opacity: s?.opacity, zIndex: s?.zIndex,
                    transform: s?.transform, filter: s?.filter, backdropFilter: s?.backdropFilter,
                    contain: s?.contain, isolation: s?.isolation, rect: r ? [r.x, r.y, r.width, r.height] : null };
            };
            const sample = now => {
                if (stopped) return;
                const surfaces = descriptors.filter(d => app[d.state]).map(d => {
                    const node = document.querySelector(d.selector), panel = node?.querySelector(d.layers[0]);
                    const r = panel?.getBoundingClientRect();
                    const hit = r && document.elementFromPoint(Math.max(1, r.left + r.width / 2), Math.max(1, r.top + 30));
                    return { ...layer(node, d.selector), foregroundHit: !!panel?.contains(hit),
                        layers: d.layers.map(selector => layer(node?.querySelector(selector), selector)) };
                });
                frames++;
                const shared = surfaces.length ? ['html', 'body', 'body > aside.group', 'body > main > header']
                    .map(selector => layer(document.querySelector(selector), selector)) : [];
                const signature = JSON.stringify([surfaces, shared]);
                if (signature !== lastSignature || now - lastHeartbeat > 1000) {
                    log('animation-frame-state', { frames, surfaces, shared }); lastSignature = signature; lastHeartbeat = now;
                }
                sampleHandle = requestAnimationFrame(sample);
            };
            sampleHandle = requestAnimationFrame(sample);
        }
        log('ready', { selected, fixture, observe: params.get('observe') === '1' });
    }
    document.addEventListener('alpine:initialized', wire, { once: true });
    document.addEventListener('DOMContentLoaded', wire, { once: true });
    const api = { enabled: true, selected, snapshot: () => snapshot(targets()),
        verifyFilters() {
            const coverage = snapshot(targets());
            const applicable = ['nobgglass', 'nobackdrop', 'nomodalblur'].includes(selected);
            const status = !applicable ? 'not-applicable' : !coverage.visibleElements ? 'not-visible'
                : coverage.filtered.length ? 'failed' : 'verified';
            const passed = status === 'verified' ? true : status === 'failed' ? false : null;
            log('computed-filter-verification', { passed, status, ...coverage });
            return { passed, status, ...coverage };
        },
        mark: () => {
            const timingMark = 'rss-flicker-mark-' + Date.now();
            if (typeof performance.mark === 'function') performance.mark(timingMark);
            log('user-flicker-mark', { timingMark });
        },
        export: () => ({ selected, fixture, observe: params.get('observe') === '1', timeOrigin: performance.timeOrigin,
            started, exportedAt: Date.now(), frames, records: Array.from({ length: count }, (_, i) => records[(cursor - count + i + records.length) % records.length]) }),
        download() {
            const url = URL.createObjectURL(new Blob([JSON.stringify(api.export(), null, 2)], { type: 'application/json' }));
            const a = document.createElement('a'); a.href = url; a.download = `flicker-${selected}-${Date.now()}.json`; a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        },
        restoreBaseline() {
            // Reload is deliberate: simply unpatching timers would leave
            // suppressed interval IDs in the current Alpine component.
            const url = new URL(location.href); url.searchParams.delete('flicker'); url.searchParams.delete('observe'); location.assign(url.href);
        },
        stop() { stopped = true; cancelAnimationFrame(sampleHandle); cleanups.reverse().forEach(fn => fn());
            document.removeEventListener('alpine:initialized', wire); document.removeEventListener('DOMContentLoaded', wire);
            log('stopped-reload-required', { reason: 'Suppressed timers need a fresh page to return to baseline' }); }
    };
    window.__flickerDiagnostic = api;
    const markHandler = event => {
        if (event.ctrlKey && event.shiftKey && event.code === 'KeyM') { api.mark(); console.info('[flicker] marked', Date.now()); }
    };
    window.addEventListener('keydown', markHandler);
    cleanups.push(() => window.removeEventListener('keydown', markHandler));
    log('configuration', { selected, fixture, observe: params.get('observe') === '1' });
    console.info('[flicker diagnostic — development only]', { selected, fixture, observe: params.get('observe') === '1' });
    wire();
    return api;
}
