import { createCoalescedJob } from '../../runtime/coalesced-job.js';
import { canonicalSmartCategory } from '../../utils/smart-destinations.js';

export function coalesceSmartRefresh(run, report) {
    const job = createCoalescedJob({
        name: 'smart-refresh', run: input => run(input.onProgress, input.category, input.options), report,
        merge: (previous, next) => ({
            ...next,
            // Different targeted refreshes become one full refresh, so every
            // requested destination is represented in the final publication.
            category: previous.category === next.category ? next.category : null,
            options: { ...previous.options, ...next.options,
                forceRebuild: previous.options.forceRebuild === true || next.options.forceRebuild === true },
        }),
    });
    return (onProgress = null, category = null, options = {}) => job.request({
        onProgress, category: category ? canonicalSmartCategory(category) : null, options,
    });
}
