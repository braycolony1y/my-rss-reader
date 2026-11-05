import { getCurrentArticleFetchLaneContext } from './fetch-lanes.js';
import { sourceCooldown } from './source-cooldown.js';
import { publisherVerificationError } from './publisher-verification.js';
import {deferPublisherVerification} from './publisher-fallbacks.js';

export function notifyReaderVerification(url, context = getCurrentArticleFetchLaneContext()) {
    context.onVerification?.({ url });
    if (deferPublisherVerification(url, publisherVerificationError())) return;
    // Human waiting is already in progress; record before that wait finishes.
    const recorded = sourceCooldown.record(url, publisherVerificationError());
    context.publisherRecovery?.track(recorded);
    void recorded.catch(error => console.error('[SOURCE COOLDOWN]', error.message));
}

export function createVerificationNoticeMiddleware(updateProgress) {
    return (req, res, next) => {
        const context = getCurrentArticleFetchLaneContext();
        const json = res.json.bind(res);
        context.onVerification = details => {
            if (context.lane !== 'p0') return;
            const notice = {
                ...details,
                message: 'This source requires security verification. Complete it in the reader’s Chrome window, or open the original article. Then retry if reading does not resume.'
            };
            res.publisherVerificationNotice = notice;
            updateProgress(context.requestId, 'verification', notice.message, { publisherVerification: notice, requiresHumanVerification: true });
        };
        res.json = payload => json(withVerificationNotice(res, payload));
        next();
    };
}

export function withVerificationNotice(res, payload) {
    return res.publisherVerificationNotice && payload && typeof payload === 'object'
        ? { ...payload, publisherVerification: res.publisherVerificationNotice } : payload;
}

export function retainVerificationNotice(previous, extra) {
    return previous?.publisherVerification && !extra.publisherVerification
        ? { publisherVerification: previous.publisherVerification } : {};
}
