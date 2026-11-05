import {isPublisherVerification, publisherVerificationError} from '../articles/publisher-verification.js';

// A blocked transport is not a blocked feed when another normal reader works.
export function createFeedFallbackFailures(target, log) {
    const failures = [];
    let verification;
    return {
        record(method, error) {
            if (error.code === 'SOURCE_COOLDOWN') throw error;
            if (isPublisherVerification(error) && (!verification || (error.retryAfterMs || 0) > (verification.retryAfterMs || 0))) verification = error;
            const failure = `${method}: ${String(error.message || error).slice(0, 200)}`;
            failures.push(failure);
            log(`[RSS FETCH] ${failure} for ${target}; trying next method`);
        },
        summary: () => failures.join('; '),
        error() {
            const error = verification ? publisherVerificationError({status: verification.status, retryAfterMs: verification.retryAfterMs}) : new Error();
            error.message = `All RSS fetch methods failed (${failures.join('; ')})`;
            return error;
        }
    };
}
