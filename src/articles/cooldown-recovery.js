import {randomUUID} from 'node:crypto';

export const newCooldownIncident = () => randomUUID();
export const cooldownIncident = state => state?.strikes > 0 && Number.isFinite(state.lastBlockedAt)
    ? state.incidentId || `${state.lastBlockedAt}:${state.until}:${state.strikes}` : null;

// Clearing is conditional: a late success must not remove a newer incident.
// Use the cooldown owner's persistence queue so the reset survives restart.
export async function resetCooldownIncident({states, source, expectedIncident, persist}) {
    const previous = states[source];
    if (!expectedIncident || cooldownIncident(previous) !== expectedIncident) return false;
    delete states[source];
    try { await persist(JSON.stringify(states)); }
    catch (error) {
        if (!states[source]) states[source] = previous;
        console.error('[SOURCE COOLDOWN] Could not persist recovery:', error.message);
        return false;
    }
    console.info(`[SOURCE COOLDOWN] ${source}: verified reader recovery; background fetching resumed`);
    return true;
}
