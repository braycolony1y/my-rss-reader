import { startFixtureServer } from '../../../test/helpers/frontend-refactor/server.js';

// Exercise the endpoints actually requested by ReaderAiStatus, with changing
// values and stable row identities. This server never contacts AI providers.
export function startUsageFixture(options = {}) {
    const revisions = { progress: 0, debug: 0, usage: 0, feed: 0 };
    const progress = () => ({ state: 'refreshing', providerOrder: ['antigravity-low', 'gemini-web', 'gemini-flash'],
        progress: { active: true, total: 100, current: ++revisions.progress % 100,
            percent: revisions.progress % 100, message: 'Fixture live progress' } });
    return startFixtureServer({ ...options, transformResponse(value, url) {
        if (url.pathname === '/api/smart-status') return progress();
        if (url.pathname === '/api/gemini-key-status') return {
            configured: true, valid: true, state: 'ready', keyCount: 7, activeKey: 1,
            providerHealth: { antigravity: { state: 'healthy' } }, lastSmartRun: progress()
        };
        if (url.pathname === '/api/summary/debug') return {
            queue: { processing: true, queueLength: 3, stats: { generated: ++revisions.debug, failed: 0 } },
            gemini: { activeKeyIndex: revisions.debug % 2, totalKeys: 7,
                keys: Array.from({ length: 7 }, (_, index) => ({ index, label: `Fixture key ${index + 1}`,
                    status: index === revisions.debug % 2 ? 'Active' : 'Standby', requestsToday: revisions.debug })) }
        };
        if (url.pathname === '/api/online-ai-usage') {
            ++revisions.usage;
            return { generatedAt: new Date().toISOString(), totalEvents: 40, rangeStart: 1, rangeEnd: 40,
                summary: { totalRequests: revisions.usage },
                events: Array.from({ length: 40 }, (_, i) => ({ id: `event-${i}`, provider: 'gemini-web',
                    status: 'success', operation: 'cluster', model: 'fixture', timestamp: '2026-11-07T09:00:00Z',
                    durationMs: 1000 + revisions.usage, message: `Activity revision ${revisions.usage}` })) };
        }
        if (url.pathname === '/api/data') {
            ++revisions.feed;
            return { ...value, articles: value.articles.map(a => ({ ...a,
                title: `${a.title} — refresh ${revisions.feed}` })) };
        }
        return value;
    }});
}
