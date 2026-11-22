// Runs inside the page against real Alpine/templates and controlled fixture I/O.
export async function interactionScenarios() {
    const app = Alpine.$data(document.body);
    const frame = () => new Promise(requestAnimationFrame);
    const settle = async () => { while (app.isLoadingArticles) await frame(); await frame(); };
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const cards = () => [...document.querySelectorAll('.article-card')];
    const output = {};
    app.setFilter('feed', 'https://example.test/feed');
    await settle();
    const initial = cards();
    const fetchBefore = window.fetch;
    let listRequests = 0;
    window.fetch = (url, ...rest) => {
        if (String(url).startsWith('/api/data?')) listRequests++;
        return fetchBefore(url, ...rest);
    };
    const counts = [];
    for (let i = 0; i < 6; i++) {
        app.setFilter('feed', 'https://example.test/feed');
        await frame(); counts.push(cards().length);
        await settle();
    }
    output.sameDestination = {requests: listRequests, counts,
        reused: cards().filter(card => initial.includes(card)).length};
    window.fetch = fetchBefore;

    // A slow foreground refresh must keep the exact view, but its eventual
    // response owns membership, ordering, and removed metadata.
    const rows = JSON.parse(JSON.stringify(app.articles));
    const previousCards = cards();
    let deliver;
    window.fetch = (url, ...rest) => String(url).startsWith('/api/data?')
        ? new Promise(resolve => { deliver = resolve; }) : fetchBefore(url, ...rest);
    const refresh = app.fetchData();
    await frame();
    output.foregroundRefresh = {waitingCards: cards().length};
    deliver(new Response(JSON.stringify({articles: rows, hasMore: false})));
    await refresh; await frame();
    output.foregroundRefresh.reused = cards().filter(card => previousCards.includes(card)).length;
    window.fetch = fetchBefore;

    await app.openArticleOverlay(app.articles[0]);
    await pause(400);
    const text = () => document.querySelector('.article-rendered-content')?.textContent.length || 0;
    output.close = {beforeLength: text(), frames: []};
    const root = document.querySelector('.article-overlay-root');
    const panel = document.querySelector('.article-overlay-panel');
    const started = performance.now();
    app.closeArticleOverlay({closeAll: true});
    for (let i = 0; i < 30; i++) {
        await frame();
        const display = getComputedStyle(root).display;
        output.close.frames.push({ms: performance.now() - started, display,
            inlineDisplay: root.style.display, open: app.articleOverlayOpen, closing: app.articleOverlayClosing,
            panelDisplay: getComputedStyle(panel).display, opacity: getComputedStyle(panel).opacity, textLength: text(),
            scrollLocked: document.getElementById('scroll-container').classList.contains('overflow-hidden')});
        if (display === 'none') break;
    }
    await frame();
    output.close.clearedAfterHidden = app.overlayContent === null;
    output.close.clearedBeforeRootHidden = output.close.frames.filter(row => row.display !== 'none' && !row.textLength).length;
    output.close.blankVisibleFrames = output.close.frames.filter(row => row.display !== 'none'
        && row.panelDisplay !== 'none' && Number(row.opacity) > 0.01 && !row.textLength).length;

    // Reopening during leave must cancel the old cleanup barrier.
    await app.openArticleOverlay(app.articles[0]); await pause(350);
    app.closeArticleOverlay({closeAll: true});
    await app.openArticleOverlay(app.articles[1]);
    await pause(350);
    output.reopen = {open: app.articleOverlayOpen, textLength: text(),
        correctArticle: app.overlayArticle?.link === app.articles[1].link};
    app.closeArticleOverlay({closeAll: true}); await pause(300);

    // Six destinations, delayed old-route completion, and a later back/forward
    // destination: the old continuation must never open its stale article.
    const sections = ['news_vietnam','news_global','finance_vietnam','finance_global','tech_vietnam','tech_global'];
    output.sections = [];
    for (const section of sections) {
        app.setFilter('smart', section); await settle();
        output.sections.push({section, selected: app.selectedFilterValue, cards: cards().length});
    }
    const fetchData = app.fetchData;
    const pending = [];
    app.fetchData = () => new Promise(resolve => pending.push(resolve));
    history.replaceState(null, '', '#feed/old?article=' + encodeURIComponent(rows[0].link));
    const old = app.handleHashChange();
    history.replaceState(null, '', '#feed/current');
    const current = app.handleHashChange();
    pending[1](); await current;
    pending[0](); await old;
    output.historyRace = {selected: app.selectedFilterValue, overlayOpen: app.articleOverlayOpen};
    app.fetchData = fetchData;
    return output;
}
