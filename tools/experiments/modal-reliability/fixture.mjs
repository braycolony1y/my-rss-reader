import { startFixtureServer } from '../../../test/helpers/frontend-refactor/server.js';

export function startModalFixture(options = {}) {
    let revision = 0;
    return startFixtureServer({ ...options, transformResponse(value, url) {
        if (url.pathname === '/api/gemini-key-status') return {
            configured: true, valid: true, state: 'ready', activeKeyIndex: 0, totalKeys: 7,
            keys: Array.from({length: 7}, (_, i) => ({index: i, masked: `fixture-${i}`, state: 'ready'})),
            lastSmartRun: {state: 'refreshing', progress: {active: true, total: 100, completed: 30}}
        };
        if (url.pathname === '/api/smart-ai-status') return {running: true, progress: {active: true, total: 100, completed: ++revision % 100}};
        if (url.pathname === '/api/online-ai-usage') return {
            summary: {total: 100, success: 80, failed: 20}, providers: [], models: [],
            events: Array.from({length: 100}, (_, i) => ({id: `event-${i}`, status: 'success', provider: 'gemini-web', model: 'fixture', operation: 'story-briefing', timestamp: '2026-10-23T10:00:00Z', durationMs: 1000 + revision, rawResponse: 'Fixed fixture response'}))
        };
        return value;
    }});
}
