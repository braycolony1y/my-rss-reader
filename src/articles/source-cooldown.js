import { sourceFetchPolicyIdentity } from '../smart/sources/fetch-identity.js';
import { assertNoPublisherVerification, isPublisherVerification } from './publisher-verification.js';
import {createCooldownIncidents} from './cooldown-incidents.js';
import {currentManualPublisherRefresh, withCapturedManualPublisherRefresh} from './manual-publisher-refresh.js';
import {publisherFetchContext, withPublisherFetchContext} from './publisher-fetch-context.js';
import {PUBLISHER_COOLDOWN_KEYS} from './publisher-cooldown-policy.js';

const STATE_KEY = 'publisherVerificationCooldowns';
const MINUTE = 60_000;

export function createSourceCooldown({ now = Date.now, baseMs = 5 * MINUTE, maxMs = 6 * 60 * MINUTE, quietMs = 24 * 60 * MINUTE, stateKey = STATE_KEY } = {}) {
    let states = {};
    let db;
    let ready = Promise.resolve();
    function ensureReady() {
        ready ||= Promise.resolve(db.get(stateKey, { type: 'json' })).then(value => { states = value || {}; });
        return ready;
    }
    async function initialize(storage, { lazy = false } = {}) {
        db = storage;
        states = {};
        ready = null;
        if (!lazy) await ensureReady();
    }
    function get(url) {
        const source = sourceFetchPolicyIdentity(url);
        return { source, ...(states[source] || {}), remainingMs: Math.max(0, (states[source]?.until || 0) - now()) };
    }
    const incidents = createCooldownIncidents({ready: ensureReady, states: () => states, storage: () => db,
        get, now, baseMs, maxMs, quietMs, stateKey});
    const {record, inspect, reset} = incidents;
    async function run(url, task, { lane = 'p3', onVerification, publisherRecovery, recordVerification = true, manualPublisherRefresh } = {}) {
        const state = await inspect(url);
        const manual = currentManualPublisherRefresh(url, manualPublisherRefresh);
        if (lane !== 'p0' && state.remainingMs > 0 && !manual) {
            throw Object.assign(new Error(`Background fetching for ${state.source} is paused until ${new Date(state.until).toISOString()} after publisher verification.`), {
                code: 'SOURCE_COOLDOWN', source: state.source, retryAt: state.until
            });
        }
        try {
            // Each fallback attempt can start after another request recorded a pause.
            publisherRecovery?.observe(state);
            return assertNoPublisherVerification(await withCapturedManualPublisherRefresh({manualPublisherRefresh: manual}, () => task(state)));
        } catch (error) {
            if (recordVerification && error.code !== 'SOURCE_COOLDOWN' && isPublisherVerification(error)) {
                const cooldown = manual?.hasExisting(state.source) ? state : await record(url, error, state.lastBlockedAt || 0);
                manual?.observe(cooldown);
                publisherRecovery?.observe(cooldown);
                if (lane === 'p0') onVerification?.({ url, source: cooldown.source, retryAt: cooldown.until });
            }
            throw error;
        }
    }
    return { initialize, get, inspect, record, run, reset };
}

export const articleSourceCooldown = createSourceCooldown({stateKey: PUBLISHER_COOLDOWN_KEYS.article});
export const rssSourceCooldown = createSourceCooldown({stateKey: PUBLISHER_COOLDOWN_KEYS.rss});
export function publisherCooldown(kind = publisherFetchContext()?.kind) {
    return kind === 'rss' ? rssSourceCooldown : articleSourceCooldown;
}

// Nested transports inherit their acquisition's circuit, including queued work.
export const sourceCooldown = {
    async initialize(...args) {
        await Promise.all([articleSourceCooldown.initialize(...args), rssSourceCooldown.initialize(...args)]);
    },
    get: (...args) => publisherCooldown().get(...args),
    inspect: (...args) => publisherCooldown().inspect(...args),
    record: (...args) => publisherCooldown().record(...args),
    reset: (...args) => publisherCooldown().reset(...args),
    run(url, task, options = {}) {
        const context = publisherFetchContext(options.publisherFetchContext);
        return withPublisherFetchContext(context, () => {
            if (context?.attempt?.active && context.attempt.owns(url)) {
                const manual = currentManualPublisherRefresh(url, options.manualPublisherRefresh);
                return withCapturedManualPublisherRefresh({manualPublisherRefresh: manual}, () => context.attempt.transport(url, task, options));
            }
            return publisherCooldown(context?.kind).run(url, task, options);
        });
    }
};
