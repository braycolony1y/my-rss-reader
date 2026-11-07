// Test setup only: state changes open existing production shells, never replace
// their implementation. Article and AI entry points run their real I/O paths.
export const surfaces = [
    { name: 'article', selector: '.article-overlay-root', state: 'articleOverlayOpen',
        panelSelector: '.article-overlay-panel', backdropSelector: '.article-overlay-backdrop',
        scrollerSelector: '#overlay-scroll-container' },
    ...['showAddFeedModal', 'contentFilterSettingsOpen', 'smartSourcesSettingsOpen', 'editModalOpen',
        'logsPanelOpen', 'boardModalOpen', 'debugModalOpen', 'cacheRulesOpen'].map(state => ({
        name: state, state, selector: `[x-show="${state}"]`
    })),
    { name: 'cacheHistory', state: 'cacheHistory', selector: '[x-show="cacheHistory"]' },
    { name: 'feedbackSession', state: 'feedbackSession', selector: '.smart-feedback-backdrop',
        panelSelector: '#smart-feedback-picker' },
    { name: 'legacy-providers', selector: '#ai-providers-modal' }
];

export async function openSurface(surface) {
    const app = Alpine.$data(document.body);
    if (surface.name === 'article') {
        document.querySelector('.article-card h2').click();
        const started = performance.now();
        while (!app.overlayContent && performance.now() - started < 10000)
            await new Promise(resolve => setTimeout(resolve, 30));
    } else if (surface.state) {
        if (surface.state === 'editModalOpen') app.editingFeed = { ...app.feeds[0] };
        if (surface.state === 'cacheHistory') app.cacheHistory = { author_name: 'Fixture', post_id: '1', versions: [
            { version: 1, captured_at: '2026-11-07T09:00:00Z', content: 'Previous fixture post' },
            { version: 2, captured_at: '2026-11-07T10:00:00Z', content: 'Updated fixture post' }
        ] };
        else if (surface.state === 'feedbackSession') app.feedbackSession = {
            article: { ...app.articles[0], feedbackSection: 'news_vietnam' }, displayed: [], selected: [], input: ''
        };
        else app[surface.state] = true;
    } else {
        const root = document.querySelector(surface.selector);
        root.classList.replace('hidden', 'flex');
    }
}

export function closeSurface(surface) {
    const app = Alpine.$data(document.body);
    if (surface.name === 'article') app.closeArticleOverlay({ closeAll: true });
    else if (surface.state) app[surface.state] = ['cacheHistory', 'feedbackSession'].includes(surface.state) ? null : false;
    else document.querySelector(surface.selector).classList.replace('flex', 'hidden');
}

export function startSurfaceWorkload({ surface, seconds }) {
    const app = Alpine.$data(document.body), root = document.querySelector(surface.selector);
    const scroller = surface.scrollerSelector ? root.querySelector(surface.scrollerSelector) : root.firstElementChild;
    const start = performance.now();
    const timer = setInterval(() => {
        const secondsElapsed = (performance.now() - start) / 1000;
        if (secondsElapsed < seconds * 2 / 3 && scroller)
            scroller.scrollTop = (Math.sin(secondsElapsed * (secondsElapsed > seconds / 3 ? 4 : .5)) + 1) * 250;
        app.clockNow = Date.now();
    }, 60);
    const refresh = setInterval(() => app.fetchData(false, true, true), 1500);
    window.stopSurfaceWorkload = () => { clearInterval(timer); clearInterval(refresh); };
}
