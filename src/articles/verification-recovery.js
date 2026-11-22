import {sourceCooldown} from './source-cooldown.js';
import {cooldownIncident} from './cooldown-recovery.js';
import {getCurrentArticleFetchLaneContext} from './fetch-lanes.js';
import {assertArticleResultAcceptedBySource} from './source-results.js';

export async function createReaderVerificationRecovery(url, {cooldown = sourceCooldown,
    context = getCurrentArticleFetchLaneContext()} = {}) {
    const incidents = new Map(), pending = [];
    const session = {
        observe(state) {
            const incident = cooldownIncident(state);
            if (state.source && incident) incidents.set(state.source, incident);
        },
        track(promise) {
            const observed = promise.then(state => session.observe(state));
            observed.catch(() => {});
            pending.push(observed);
        },
        async accept(result) {
            if (context.lane !== 'p0' || !result?.content || result.error || result.cached
                || result.sourceDeleted || result.isDeletedSource || result.isDeletedThread || result.partialContent) return false;
            const text = result.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            if (text.length < 200 && !/<(?:video|audio|img)\b/i.test(result.content)) return false;
            try {assertArticleResultAcceptedBySource(url, result);} catch {return false;}
            await Promise.allSettled(pending);
            const current = await cooldown.inspect(url);
            return cooldown.reset(url, incidents.get(current.source));
        }
    };
    context.publisherRecovery = session;
    session.observe(await cooldown.inspect(url));
    return session;
}
