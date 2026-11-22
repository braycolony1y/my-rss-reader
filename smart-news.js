// Compatibility entry point. Implementations and private runtime state live in src/smart.
// Keep these exports stable for server, worker, route and test consumers.

export { EMBEDDING_CACHE_FILE } from './src/smart/embeddings/config.js';
export { updateBatchStopTokens, tokenSimilarity, tokenOverlapCount } from './src/smart/text/normalize.js';
export { stableId, getArticleId } from './src/smart/articles/identity.js';
export { sourceFetchPolicyIdentity, canonicalSourceIdentity, isExcludedFromSmart } from './src/smart/sources/identity.js';
export { refineArticleCategory } from './src/smart/articles/categories.js';
export { normalizeArticle } from './src/smart/articles/normalize.js';
export { buildEmbeddingText, embeddingCacheKey, disposeEmbeddingModel, prepareEmbeddings, importEmbeddingCache, exportEmbeddingCache, clearEmbeddingCache, loadEmbeddings, saveEmbeddings } from './src/smart/embeddings/index.js';
export { detectEventConflicts } from './src/smart/clustering/event-evidence.js';
export { MatchDecision, getSmartDestinationPartition, classifyE5Match, isAiRecoveryReviewCandidate, isPairWithinComparisonScope } from './src/smart/clustering/similarity.js';
export { deterministicGroups } from './src/smart/clustering/components.js';
export { isGenuinelyRelated, attachBroaderStoryMetadata } from './src/smart/clustering/relationships.js';
export { dedupeGoogleNewsWrappers } from './src/smart/sources/wrappers.js';
export { calculateHotness, getHotnessLabel, buildCluster, buildEarlySmartClusters, cleanStoredCluster } from './src/smart/clustering/cluster.js';
export { buildPublicationClusterSnapshot } from './src/smart/clustering/publication-snapshot.js';
export { buildComponentReviewUnits } from './src/smart/verification/prompts.js';
export { validateComponentReviewResult, expandComponentReviewDecision, validatePartitionResult } from './src/smart/verification/validation.js';
export { setClusteringModel } from './src/smart/verification/provider-config.js';
export { normalizeAntigravityClusteringOutput } from './src/smart/verification/providers.js';
export { verificationCacheKey, getCachedVerificationDecision, setCachedVerificationDecision } from './src/smart/verification/cache.js';
export { verifyWithProviderChain } from './src/smart/verification/review.js';
export { prepareIncrementalReviewGroups, integrateIncrementalReviews } from './src/smart/clustering/review-groups.js';
export { startSmartSyncLoop } from './src/smart/background/source-sync.js';
export { scheduleMonthlySourceEvaluation } from './src/smart/background/source-evaluation.js';
export { createSmartNewsEngine } from './src/smart/refresh/engine.js';
export { runIncrementalHnswClustering } from './smart-hnsw-clustering.js';
