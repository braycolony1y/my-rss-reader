// Frequently changing Smart metadata is independent of the two article corpora.
// Reuse the durable keyed overlay so a status/rank/publication update does not
// rewrite both the complete Smart corpus and its backup.
// TODO remove after delete-ai-data: smartVerificationFailures, smartProgressivePublication,
// smartProgressiveClusterState and topStoriesPublished are retired AI keys (nothing reads or writes them);
// they stay so the legacy JSON store accepts overlays that still contain them.
export const SMART_INCREMENTAL_KEYS = [
    'smartCandidateLinks', 'smartCandidateSignature', 'smartAiConfig',
    'smartClusterVersion', 'smartEmbeddingIdentity', 'smartVerificationFailures',
    'smartClusteringInputs', 'smartClusteringFailedAttempt',
    'smartClusteringAlgorithmVersion', 'smartClusterState',
    'smartDeferredReviewGroups', 'smartProgressivePublication',
    'smartProgressiveClusterState', 'topStoriesPublished'
];
