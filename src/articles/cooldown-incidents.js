import {newCooldownIncident, resetCooldownIncident} from './cooldown-recovery.js';

// One owner orders state changes together with durable snapshots and rollback.
// Queuing only writes lets another publisher capture a failed reset mid-flight.
export function createCooldownIncidents({ready, states, storage, get, now, baseMs, maxMs, quietMs, stateKey}) {
    let tail = Promise.resolve();
    const ordered = operation => {
        const result = tail.then(operation);
        tail = result.catch(() => {});
        return result;
    };
    const persist = snapshot => storage()?.put(stateKey, snapshot);
    return {
        async inspect(url) {await ready(); return ordered(() => get(url));},
        async record(url, error, admittedAt) {
            await ready();
            return ordered(async () => {
                const previous = get(url);
                if (!previous.source) return previous;
                if (admittedAt !== undefined && (previous.lastBlockedAt || 0) !== admittedAt) return previous;
                if (previous.remainingMs > 0) return previous;
                const strikes = now() - (previous.lastBlockedAt || 0) >= quietMs ? 1 : (previous.strikes || 0) + 1;
                const durationMs = Math.max(Math.min(maxMs, baseMs * 2 ** Math.min(strikes - 1, 20)), Number(error?.retryAfterMs) || 0);
                states()[previous.source] = {strikes, lastBlockedAt: now(), until: now() + durationMs,
                    durationMs, incidentId: newCooldownIncident()};
                console.warn(`[SOURCE COOLDOWN] ${previous.source}: background fetches paused for ${Math.ceil(durationMs / 60000)} minutes (incident ${strikes})`);
                try {await persist(JSON.stringify(states()));}
                catch (error) {console.error('[SOURCE COOLDOWN] Could not persist pause:', error.message);}
                return get(url);
            });
        },
        async reset(url, expectedIncident) {
            await ready();
            return ordered(() => resetCooldownIncident({states: states(), source: get(url).source,
                expectedIncident, persist}));
        }
    };
}
