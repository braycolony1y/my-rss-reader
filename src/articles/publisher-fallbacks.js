import {publisherCooldown} from './source-cooldown.js';
import {publisherFetchContext, withPublisherFetchContext} from './publisher-fetch-context.js';
import {sourceFetchPolicyIdentity} from '../smart/sources/fetch-identity.js';
import {assertNoPublisherVerification, isPublisherVerification, publisherVerificationError} from './publisher-verification.js';
import {cooldownIncident} from './cooldown-recovery.js';
import {currentManualPublisherRefresh} from './manual-publisher-refresh.js';

const failedResult = result => result == null || result.error || result.failed || result.ok === false || result.liveRefreshFailed;
const liveResult = result => !failedResult(result) && !result.cached && !result.partialContent
    && !result.sourceDeleted && !result.isDeletedSource && !result.isDeletedThread;

// One acquisition owns admission and the final verdict; transports only report
// failures. Feed lists and article content have independent durable incidents.
export async function runPublisherFallbacks(initialUrl, task, {
    kind = publisherFetchContext()?.kind || 'article', cooldown = publisherCooldown(kind),
    lane = 'p3', context = {}, urls = [initialUrl], failed = failedResult,
    accepted = liveResult, join = true, lazyAdmission = false
} = {}) {
    const parent = publisherFetchContext();
    if (join && parent?.kind === kind && parent.attempt?.active && parent.attempt.owns(initialUrl)) return task();
    let url = initialUrl, admission, admitting;
    const sources = new Set(urls.map(sourceFetchPolicyIdentity));
    const observed = new Map();
    const admit = () => admitting ||= withPublisherFetchContext({kind}, () => cooldown.run(url, state => {
        admission = state;
        return true;
    }, {...context, lane, recordVerification: false}));
    const attempt = {
        active: true,
        owns: target => sources.has(sourceFetchPolicyIdentity(target)),
        target(target) {
            if (admitting) return;
            url = target;
            sources.add(sourceFetchPolicyIdentity(target));
        },
        observe(target, error) {
            if (!attempt.owns(target) || !isPublisherVerification(error)) return;
            const source = sourceFetchPolicyIdentity(target), previous = observed.get(source);
            if (!previous || (error.retryAfterMs || 0) > (previous.retryAfterMs || 0)) observed.set(source, error);
        },
        async transport(target, execute, options) {
            await admit();
            try {return assertNoPublisherVerification(await execute());}
            catch (error) {
                attempt.observe(target, error);
                if (options.lane === 'p0' && isPublisherVerification(error)) options.onVerification?.({url: target});
                throw error;
            }
        }
    };
    return withPublisherFetchContext({kind, attempt}, async () => {
        try {
            if (!lazyAdmission) await admit();
            let result, failure;
            try {
                result = await task();
                if (failed(result)) failure = new Error('All publisher fallback methods failed');
            } catch (error) {failure = error;}
            if (failure) {
                attempt.observe(url, failure);
                const verification = [...observed.values()].sort((a, b) => (b.retryAfterMs || 0) - (a.retryAfterMs || 0))[0];
                if (verification && failure.code !== 'SOURCE_COOLDOWN') {
                    const manual = currentManualPublisherRefresh(url, context.manualPublisherRefresh);
                    const state = manual?.hasExisting(sourceFetchPolicyIdentity(url)) ? admission
                        : await cooldown.record(url, verification, admission?.lastBlockedAt || 0);
                    if (state) {
                        manual?.observe(state);
                        context.publisherRecovery?.observe(state);
                        if (lane === 'p0') context.onVerification?.({url, source: state.source, retryAt: state.until});
                    }
                }
                if (result === undefined) {
                    if (verification && failure.code !== 'SOURCE_COOLDOWN') {
                        const error = publisherVerificationError({status: verification.status, retryAfterMs: verification.retryAfterMs});
                        error.message = failure.message;
                        throw error;
                    }
                    throw failure;
                }
                return result;
            }
            if (admission && accepted(result)) await cooldown.reset(url, cooldownIncident(admission));
            return result;
        } finally {attempt.active = false;}
    });
}

export function retargetPublisherFallbacks(url) {
    publisherFetchContext()?.attempt?.target(url);
}

export function deferPublisherVerification(url, error) {
    const attempt = publisherFetchContext()?.attempt;
    if (!attempt?.active || !attempt.owns(url)) return false;
    attempt.observe(url, error);
    return true;
}
