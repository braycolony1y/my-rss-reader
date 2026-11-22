export async function nativeRefreshStress() {
    const app = Alpine.$data(document.body), frame = () => new Promise(requestAnimationFrame);
    app.setFilter('today', null);
    while (app.isLoadingArticles) await frame();
    await frame();
    const cards = [...document.querySelectorAll('.article-card')];
    const rows = JSON.parse(JSON.stringify(app.articles)), original = window.fetch;
    let deliver;
    window.fetch = (url, ...rest) => String(url).startsWith('/api/data?')
        ? new Promise(resolve => {deliver = resolve;}) : original(url, ...rest);
    try {
        const button = [...document.querySelectorAll('li')].find(node => node.getAttribute('@click') === "setFilter('today', null)");
        button.click();
        await frame();
        const waitingCards = document.querySelectorAll('.article-card').length;
        deliver(new Response(JSON.stringify({articles: rows, hasMore: false})));
        while (app.isLoadingArticles) await frame();
        await frame();
        return {waitingCards, reused: [...document.querySelectorAll('.article-card')].filter(node => cards.includes(node)).length,
            freshProxyRetains: ReaderListPublication.retains(Alpine.$data(document.body))};
    } finally {window.fetch = original;}
}

export async function openScrollStress() {
    const app = Alpine.$data(document.body), frame = () => new Promise(requestAnimationFrame);
    await app.openArticleOverlay(app.articles[0]);
    await frame(); await frame();
    const root = document.querySelector('.article-overlay-root'), panel = document.querySelector('.article-overlay-panel');
    const scroller = document.getElementById('overlay-scroll-container');
    const content = app.overlayContent;
    scroller.scrollTop = 300;
    const before = scroller.scrollTop;
    await app.fetchData(false, true, true);
    await frame();
    const image = document.createElement('img');
    image.width = 120; image.height = 80; image.src = '/api/og-image?fixture=delayed';
    document.querySelector('.article-rendered-content').append(image);
    await image.decode(); await frame();
    window.__readerStressPanel = panel;
    return {scrollBefore: before, scrollAfter: scroller.scrollTop, contentUnchanged: app.overlayContent === content,
        rootVisible: getComputedStyle(root).display !== 'none', imageDecoded: image.complete};
}

export async function finishResizeStress() {
    const app = Alpine.$data(document.body);
    const result = {open: app.articleOverlayOpen, readable: Boolean(app.overlayContent),
        samePanel: window.__readerStressPanel === document.querySelector('.article-overlay-panel')};
    app.closeArticleOverlay({closeAll: true});
    delete window.__readerStressPanel;
    return result;
}
