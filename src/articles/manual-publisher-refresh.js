import {AsyncLocalStorage} from 'node:async_hooks';
import {sourceFetchPolicyIdentity} from '../smart/sources/fetch-identity.js';
import {cooldownIncident} from './cooldown-recovery.js';
import {matchesManualRefresh} from './manual-refresh-scopes.js';
import {publisherFetchContext, withPublisherFetchKind} from './publisher-fetch-context.js';

const storage = new AsyncLocalStorage();

export function currentManualPublisherRefresh(url, captured) {
    const scope = captured === undefined ? storage.getStore() : captured;
    return scope?.active && scope.kind === (publisherFetchContext()?.kind || 'article')
        && scope.sources.has(sourceFetchPolicyIdentity(url)) ? scope : null;
}

// Queue callbacks may run in the preceding job's async context. Carry the
// capability with the job, and explicitly restore an empty scope for auto work.
export function captureManualPublisherRefresh(context) {
    const scope = storage.getStore();
    if (scope) context.manualPublisherRefresh = scope;
    else if (!Object.hasOwn(context, 'manualPublisherRefresh')) context.manualPublisherRefresh = null;
    return context;
}

export function withCapturedManualPublisherRefresh(context, task) {
    return storage.run(context.manualPublisherRefresh || null, task);
}

// The capability exists only during one source's network acquisition. Parsing,
// optional metadata, caching, and speculative prefetch run after it is revoked.
export async function createManualPublisherRefresh(item, scopes, cooldown) {
    if (!matchesManualRefresh(item, scopes)) return null;
    const kind = publisherFetchContext()?.kind || 'article';
    const urls = [...new Set([item.url, item.fallbackUrl].filter(Boolean))];
    const initial = new Map(), incidents = new Map();
    const scope = {
        kind,
        active: false,
        sources: new Set(urls.map(sourceFetchPolicyIdentity)),
        hasExisting: source => Boolean(initial.get(source)),
        observe(state) {
            if (!initial.get(state.source) && cooldownIncident(state)) incidents.set(state.source, cooldownIncident(state));
        }
    };
    for (const url of urls) {
        const state = await cooldown.inspect(url), incident = cooldownIncident(state);
        initial.set(state.source, incident);
        if (incident) incidents.set(state.source, incident);
    }
    return {
        async run(task) {
            scope.active = true;
            try {return await storage.run(scope, task);}
            finally {scope.active = false;}
        },
        async accept() {
            return withPublisherFetchKind(kind, async () => {
                for (const url of urls) {
                    const source = sourceFetchPolicyIdentity(url);
                    await cooldown.reset(url, incidents.get(source));
                }
            });
        }
    };
}
