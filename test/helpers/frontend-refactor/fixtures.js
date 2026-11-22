export const articleUrl = 'https://example.test/reader-story';
export const articles = Array.from({ length: 8 }, (_, index) => ({
    id: `fixture-${index}`, link: index ? `${articleUrl}-${index}` : articleUrl,
    title: `Reader fixture ${index + 1}: a stable headline for layout comparison`,
    content: 'A stable source excerpt for the frontend extraction checks.',
    feedUrl: 'https://example.test/feed', feedTitle: 'Fixture News',
    feedIcon: '/public/default.jpg', image: '/public/default.jpg',
    pubDate: '2026-10-01T08:00:00.000Z', clusterId: `cluster-${index}`,
    isCluster: true, sourceCount: 2,
    relatedArticles: [{ link: `${articleUrl}-related`, title: 'Suggested article', feedTitle: 'Other publisher', feedIcon: '/public/default.jpg' }],
    topStory: { rank: index + 1, isTop: true, timeline: [] },
    briefing: { status: 'ready', analysisStatus: 'evaluated', sections: [
        { label: 'What happened', text: 'A stable briefing for comparison.' },
        { label: 'Why it matters', text: 'This text exercises the analysis panel.', citations: [] }
    ] }
}));

export const renderedContent = `<p>Opening paragraph for the reader.</p>
<div class="voz-post" data-post-id="1" data-absolute-post-id="1001"><div class="voz-post-header"><a class="username voz-post-author">Fixture author</a><span class="voz-post-time">Yesterday</span></div><div class="voz-post-body"><p>VOZ post with preserved presentation.</p><div class="bbCodeBlock--spoiler"><div class="bbCodeBlock-content">Spoiler content</div></div></div></div>
<div class="voz-twitter-embed"><iframe class="voz-twitter-embed__fallback" title="X fallback" src="about:blank"></iframe></div>
<div class="voz-reddit-embed"><iframe class="voz-reddit-embed__frame" title="Reddit fallback" src="about:blank"></iframe><a class="voz-reddit-embed__fallback">Read discussion</a></div>
<div class="ground-story"><div class="ground-filters"><button data-ground-filter="all">All</button><button data-ground-filter="left">Left</button></div><div data-ground-bias="left">Left publisher</div><div data-ground-bias="right">Right publisher</div><p class="ground-empty" hidden>No publishers</p></div>
<div class="techmeme-main-story"><h2>Techmeme source</h2><p>Source content.</p></div>
<div class="tinhte-photo-compare"><img src="/public/default.jpg"><div class="compare-overlay"></div><div class="compare-handle"></div><input class="compare-slider" type="range" value="50"></div>
<div class="embedded-suggested-articles"><div class="embedded-suggested-header">Suggested articles</div><div class="embedded-suggested-carousel"><div class="embedded-suggested-card"><a href="${articleUrl}-related">Open suggested article</a></div></div></div>
${'<p>Long article paragraph to exercise overlay scrolling and restoration.</p>'.repeat(20)}`;

export function createFixtureApi() {
    const state = { readStates: [], savedStates: [], boardStates: [], hiddenStates: [], recentReadAt: {}, userPreferences: {}, categoryOrder: [] };
    return function respond(url, body = {}) {
        if (url.pathname === '/api/user-preferences') state.userPreferences[body.key] = body.value;
        if (url.pathname === '/api/user-states') return state;
        if (url.pathname === '/api/data') return {
            ...state, feeds: [{ url: 'https://example.test/feed', title: 'Fixture News', category: 'News' }],
            articles: articles.filter(a => !url.searchParams.get('searchQuery') || a.title.includes(url.searchParams.get('searchQuery'))),
            topStories: articles, hasMore: false, smartTabMode: url.searchParams.get('smartMode') || 'top',
            unreadCounts: { feeds: {}, categories: {}, total: 8 }
        };
        if (url.pathname === '/api/article-content') return { url: url.searchParams.get('url'), title: 'Reader fixture', content: renderedContent, fetchStrategy: 'direct', cached: true };
        if (url.pathname === '/api/content-filter-settings') return { keywords: [] };
        if (url.pathname === '/api/smart-sources') return { sources: [] };
        if (url.pathname === '/api/board-cache/state') return { rules: [], members: {} };
        if (url.pathname === '/api/summary') return { status: 'not_found' };
        return {};
    };
}
