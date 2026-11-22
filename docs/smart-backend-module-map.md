# Smart backend modularization inventory

The completed extraction, final ownership tree, state/lifecycle notes, validation, activation and scoped diff statistics are in [the final refactor report](smart-backend-refactor-report.md). The inventory below records the original file before extraction.

Captured before production code moved. Original smart-news.js: 14,370 lines, 52 public exports. Every declaration and nested engine method is inventoried below.

## Planned owners

- src/smart/config.js: DAY_MS, HOUR_MS, SMART_REFRESH_MS, VIETNAM_OFFSET_MS, SMART_ITEMS_PER_SOURCE, SMART_CLUSTER_VERSION, VALID_SMART_CATEGORIES, EXCLUDED_SMART_FEED_URLS, SMART_NEWS_CLUSTER_CONFIG, SMART_NEWS_AI_CONFIG, LOCAL_AI_CONTEXT_TOKENS, LOCAL_AI_OUTPUT_TOKENS, LOCAL_AI_KEEP_ALIVE, LOCAL_MODEL_AVAILABILITY_TTL_MS.
- src/smart/embeddings/config.js: EMBEDDING_MODEL, EMBEDDING_CACHE_VERSION, EMBEDDING_CACHE_FILE, EMBEDDING_BATCH_SIZE.
- src/smart/verification/schemas.js: PARTITION_RESPONSE_SCHEMA, COMPONENT_REVIEW_RESPONSE_SCHEMA.
- src/smart/text/normalize.js: STOP_WORDS, batchStopTokens, stripHtml, normalizeText, escapeRegExp, containsNormalizedPhrase, cleanTitleForScoring, updateBatchStopTokens, titleTokens, tokenSimilarity, tokenOverlapCount.
- src/smart/articles/identity.js: stableId, getArticleId, createGroupId.
- src/smart/dates/publication-time.js: parsePublishedTimestamp, safeDate, toVietnamIso, freshestPublishedAt.
- src/smart/sources/identity.js: hostFromUrl, canonicalSourceUrl, normalizedSourceHostname, googleNewsPublisherHostname, rootSourceHostname, sourceFetchPolicyIdentity, canonicalSourceIdentity, publisherIcon, isExcludedSmartUrl, isExcludedFromSmart.
- src/smart/articles/language.js: containsVietnameseSignals, detectArticleLanguage, isVietnameseArticle, isEnglishArticle.
- src/smart/articles/categories.js: isInvestingComSource, refineArticleCategory, inferCategory.
- src/smart/sources/normalize.js: SMART_SOURCE_FETCH_METHODS, normalizeSmartSource, countSmartSources.
- src/smart/articles/normalize.js: normalizeArticle.
- src/smart/embeddings/index.js: embeddingPipeline, embeddingCache, buildEmbeddingText, embeddingCacheKey, embeddingWorker, workerMsgId, workerPromises, disposeEmbeddingModel, getEmbeddingWorker, getEmbeddingVector, prepareEmbeddings, importEmbeddingCache, exportEmbeddingCache, clearEmbeddingCache, generateEmbeddingCacheJsonAsync, loadEmbeddings, saveEmbeddings.
- src/smart/clustering/worker-client.js: clusterWorker, getClusterWorker.
- src/smart/clustering/similarity.js: MatchDecision, ACTION_GROUPS, cosineSimilarity, extractActionGroups, SPORTS_HEADLINE_FOCUS_PATTERNS, extractSportsHeadlineFocus, AIRLINE_HEADLINE_PATTERNS, extractHeadlineAirlines, extractHeadlineNumbers, detectEventConflicts, countSharedValues, getEventEvidence, getSmartDestinationPartition, classifyE5Match, isAiRecoveryReviewCandidate, pairKey, isPairWithinComparisonScope, chooseMedoid.
- src/smart/clustering/components.js: deterministicGroups.
- src/smart/clustering/representative.js: isPaywalledSource, chooseRepresentative.
- src/smart/clustering/relationships.js: isGenuinelyRelated, attachBroaderStoryMetadata, mergeRelatedDevelopmentRelationships.
- src/smart/clustering/publication-snapshot.js: calculateHotness, getHotnessLabel, isGoogleNewsWrapperUrl, headlineFingerprint, dedupeGoogleNewsWrappers, buildCluster, buildEarlySmartClusters, cleanStoredCluster, assertEveryCandidateAppearsExactlyOnce, getClusterArticleLinks, getLatestClusterCoverageTime, buildPublicationClusterSnapshot, isActiveCluster, extractActiveClusterArticles.
- src/smart/verification/prompts.js: buildVerificationPrompt, buildComponentReviewUnits, buildComponentReviewPrompt.
- src/smart/verification/validation.js: validateComponentReviewResult, expandComponentReviewDecision, parsePartitionResponse, validatePartitionResult, pairEligibleForVerifiedCluster, postValidatePartition.
- src/smart/verification/diagnostics.js: RAW_PROVIDER_DIAGNOSTIC_LIMIT, sanitizeProviderDiagnosticText, providerJsonDiagnosticFields, sanitizeProviderErrorMessage, normalizeProviderError, isTransientProviderError, providerDeferredError, shortGeminiWebRetryAt, isModelOutputError.
- src/smart/verification/provider-config.js: providerEnabled, preferredClusteringModel, setClusteringModel, getEnabledVerificationProviders, providerReviewArticleLimit, providerReviewComponentLimit.
- src/smart/verification/provider-health.js: providerHealthWriteChain, getProviderHealth, updateProviderHealth, recordProviderAttempt, recordProviderSuccess, recordProviderCooldown, recordProviderError.
- src/smart/verification/providers.js: localModelAvailabilityCache, requestGeminiPartition, assertLocalModelAvailable, requestLocalPartition, extractCompleteJsonRoots, normalizeAntigravityDecision, normalizeAntigravityClusteringOutput, normalizeAntigravityComponentDecision, normalizeAntigravityComponentOutput, callVerificationProvider.
- src/smart/verification/cache.js: verificationCacheWriteChain, componentVerificationCacheKey, getCachedComponentVerificationDecision, setCachedComponentVerificationDecision, normalizedVerificationArticles, verificationCacheKey, getVerificationCache, getCachedVerificationDecision, setCachedVerificationDecision.
- src/smart/verification/attempt.js: attemptProviderVerification.
- src/smart/verification/component-review.js: attemptComponentProviderVerification, verifyComponentReviewWithProviderChain.
- src/smart/verification/review.js: verifyWithProviderChain.
- src/smart/editorial/assessment.js: assessSmartEditorialClusters.
- src/smart/clustering/review-groups.js: prepareIncrementalReviewGroups, integrateIncrementalReviews, deferredReviewPartitions.
- src/smart/clustering/review.js: reviewAmbiguousEventGroups.
- src/smart/sources/fetch.js: fetchRssUrl, fetchSmartSource, fetchInBatches, hasOnlyOpenCliFetchMethod, smartArticleIdentity, prefetchOpenCliOnlySmartArticles.
- src/smart/persistence/smart-state.js: putManySafe.
- src/smart/background/source-sync.js: startSmartSyncLoop.
- src/smart/background/source-evaluation.js: scheduleMonthlySourceEvaluation.
- src/smart/refresh/coordination.js: activeSmartEngineRefreshes.
- src/smart/refresh/engine.js: createSmartNewsEngine.
- src/smart/refresh/scheduling.js: sleep.

## Complete function and cross-domain dependency map

```text
33-33 DAY_MS -> 
34-34 HOUR_MS -> 
36-36 SMART_REFRESH_MS -> 
37-37 VIETNAM_OFFSET_MS -> HOUR_MS
39-39 SMART_ITEMS_PER_SOURCE -> 
40-41 SMART_CLUSTER_VERSION -> 
43-43 EMBEDDING_MODEL -> 
44-44 EMBEDDING_CACHE_VERSION -> 
45-52 PUBLIC EMBEDDING_CACHE_FILE -> fileURLToPath
54-60 VALID_SMART_CATEGORIES -> 
62-65 EXCLUDED_SMART_FEED_URLS -> 
67-93 SMART_NEWS_CLUSTER_CONFIG -> 
95-191 SMART_NEWS_AI_CONFIG -> ANTIGRAVITY_MODEL
193-199 LOCAL_AI_CONTEXT_TOKENS -> 
201-207 LOCAL_AI_OUTPUT_TOKENS -> 
209-210 LOCAL_AI_KEEP_ALIVE -> 
212-218 EMBEDDING_BATCH_SIZE -> 
220-224 PUBLIC MatchDecision -> 
226-259 PARTITION_RESPONSE_SCHEMA -> 
262-313 COMPONENT_REVIEW_RESPONSE_SCHEMA -> 
315-355 STOP_WORDS -> 
357-422 ACTION_GROUPS -> 
424-424 batchStopTokens -> 
425-425 embeddingPipeline -> 
426-426 embeddingCache -> 
427-427 localModelAvailabilityCache -> 
428-428 LOCAL_MODEL_AVAILABILITY_TTL_MS -> 
432-432 activeSmartEngineRefreshes -> 
434-434 providerHealthWriteChain -> 
435-435 verificationCacheWriteChain -> 
437-439 sleep -> 
443-458 freshestPublishedAt -> parsePublishedTimestamp
460-481 providerDeferredError -> 
483-494 shortGeminiWebRetryAt -> getGeminiWebCooldownState
496-512 stripHtml -> decodeHTMLEntities
514-523 normalizeText -> stripHtml
525-527 escapeRegExp -> 
529-539 containsNormalizedPhrase -> normalizeText, escapeRegExp
541-582 cleanTitleForScoring -> 
584-618 PUBLIC updateBatchStopTokens -> batchStopTokens, normalizeText, cleanTitleForScoring, STOP_WORDS
620-631 titleTokens -> normalizeText, cleanTitleForScoring, STOP_WORDS, batchStopTokens
633-663 PUBLIC tokenSimilarity -> titleTokens
665-678 PUBLIC tokenOverlapCount -> titleTokens
680-691 PUBLIC stableId -> 
693-707 PUBLIC getArticleId -> stableId
709-715 createGroupId -> getArticleId, stableId
717-879 parsePublishedTimestamp -> VIETNAM_OFFSET_MS
881-889 safeDate -> parsePublishedTimestamp
891-899 toVietnamIso -> safeDate, VIETNAM_OFFSET_MS
901-909 hostFromUrl -> 
911-938 canonicalSourceUrl -> 
940-957 normalizedSourceHostname -> 
959-969 googleNewsPublisherHostname -> normalizedSourceHostname
971-981 rootSourceHostname -> normalizedSourceHostname
986-996 PUBLIC sourceFetchPolicyIdentity -> normalizedSourceHostname, googleNewsPublisherHostname, rootSourceHostname
998-1008 PUBLIC canonicalSourceIdentity -> hostFromUrl
1010-1048 publisherIcon -> hostFromUrl
1050-1066 isExcludedSmartUrl -> canonicalSourceUrl, EXCLUDED_SMART_FEED_URLS
1068-1076 PUBLIC isExcludedFromSmart -> isExcludedSmartUrl
1078-1087 containsVietnameseSignals -> 
1089-1122 detectArticleLanguage -> containsVietnameseSignals
1124-1129 isVietnameseArticle -> detectArticleLanguage
1131-1136 isEnglishArticle -> detectArticleLanguage
1138-1162 isInvestingComSource -> hostFromUrl
1164-1355 PUBLIC refineArticleCategory -> canonicalSmartCategory, hostFromUrl, detectArticleLanguage, isInvestingComSource, normalizeText, containsNormalizedPhrase
1357-1490 inferCategory -> canonicalSmartCategory, VALID_SMART_CATEGORIES, refineArticleCategory, hostFromUrl, detectArticleLanguage, normalizeText, isInvestingComSource
1492-1492 SMART_SOURCE_FETCH_METHODS -> 
1494-1576 normalizeSmartSource -> canonicalSmartCategory, canonicalSourceUrl, isExcludedSmartUrl, VALID_SMART_CATEGORIES, isInvestingComSource, stripHtml, hostFromUrl, SMART_SOURCE_FETCH_METHODS
1578-1599 countSmartSources -> 
1601-1742 PUBLIC normalizeArticle -> normalizeArticleSourceUrl, hostFromUrl, detectArticleLanguage, canonicalSmartCategory, inferCategory, refineArticleCategory, parsePublishedTimestamp, HOUR_MS, DAY_MS, stripHtml, createHash, toVietnamIso, publisherIcon
1744-1754 PUBLIC buildEmbeddingText -> cleanTitleForScoring, stripHtml
1756-1764 PUBLIC embeddingCacheKey -> createHash, EMBEDDING_MODEL, EMBEDDING_CACHE_VERSION, buildEmbeddingText
1769-1769 embeddingWorker -> 
1770-1770 workerMsgId -> 
1771-1771 workerPromises -> 
1773-1773 clusterWorker -> 
1775-1807 getClusterWorker -> clusterWorker, Worker, boundedWorkerOptions
1809-1818 PUBLIC disposeEmbeddingModel -> 
1820-1855 getEmbeddingWorker -> embeddingWorker, Worker, boundedWorkerOptions, workerPromises
1857-1889 getEmbeddingVector -> withLocalCompute, getEmbeddingWorker, workerMsgId, workerPromises
1893-1977 PUBLIC prepareEmbeddings -> monitorEventLoopDelay, buildEmbeddingText, embeddingCacheKey, embeddingCache, EMBEDDING_BATCH_SIZE, getEmbeddingVector
1979-2020 PUBLIC importEmbeddingCache -> embeddingCache
2022-2032 PUBLIC exportEmbeddingCache -> embeddingCache
2034-2036 PUBLIC clearEmbeddingCache -> embeddingCache
2038-2065 generateEmbeddingCacheJsonAsync -> embeddingCache
2067-2087 PUBLIC loadEmbeddings -> embeddingCache, readFile, EMBEDDING_CACHE_FILE, importEmbeddingCache
2089-2108 PUBLIC saveEmbeddings -> EMBEDDING_CACHE_FILE, generateEmbeddingCacheJsonAsync, writeFile, rename, unlink
2110-2133 cosineSimilarity -> 
2135-2170 extractActionGroups -> normalizeText, ACTION_GROUPS, containsNormalizedPhrase
2172-2200 SPORTS_HEADLINE_FOCUS_PATTERNS -> 
2202-2225 extractSportsHeadlineFocus -> normalizeText, SPORTS_HEADLINE_FOCUS_PATTERNS
2231-2250 AIRLINE_HEADLINE_PATTERNS -> 
2252-2274 extractHeadlineAirlines -> normalizeText, AIRLINE_HEADLINE_PATTERNS
2276-2286 extractHeadlineNumbers -> 
2288-2390 PUBLIC detectEventConflicts -> parsePublishedTimestamp, HOUR_MS, extractHeadlineAirlines, extractSportsHeadlineFocus
2392-2408 countSharedValues -> 
2410-2497 getEventEvidence -> detectArticleLanguage, tokenOverlapCount, tokenSimilarity, countSharedValues, extractHeadlineNumbers, extractActionGroups
2499-2561 PUBLIC getSmartDestinationPartition -> detectArticleLanguage
2563-2691 PUBLIC classifyE5Match -> detectArticleLanguage, MatchDecision, SMART_NEWS_CLUSTER_CONFIG, detectEventConflicts, getEventEvidence
2704-2846 PUBLIC isAiRecoveryReviewCandidate -> detectEventConflicts, parsePublishedTimestamp, HOUR_MS, detectArticleLanguage, SMART_NEWS_CLUSTER_CONFIG, getEventEvidence
2848-2852 pairKey -> 
2854-2951 PUBLIC isPairWithinComparisonScope -> getSmartDestinationPartition, parsePublishedTimestamp, SMART_NEWS_CLUSTER_CONFIG, HOUR_MS
2953-3002 chooseMedoid -> pairKey
3004-3004 PUBLIC ExportNamedDeclaration -> 
3006-4186 PUBLIC deterministicGroups -> monitorEventLoopDelay, getArticleId, SMART_NEWS_CLUSTER_CONFIG, isPairWithinComparisonScope, cosineSimilarity, classifyE5Match, MatchDecision, isAiRecoveryReviewCandidate, getEventEvidence, pairKey, stableId, createGroupId, safeDate
4187-4203 isPaywalledSource -> 
4205-4301 chooseRepresentative -> isPaywalledSource, isEnglishArticle, safeDate
4303-4305 PUBLIC calculateHotness -> rankStory
4307-4333 PUBLIC getHotnessLabel -> 
4335-4454 PUBLIC isGenuinelyRelated -> detectEventConflicts, cosineSimilarity, tokenSimilarity, tokenOverlapCount, canonicalSourceIdentity
4456-4472 isGoogleNewsWrapperUrl -> 
4474-4480 headlineFingerprint -> normalizeText, cleanTitleForScoring
4482-4528 PUBLIC dedupeGoogleNewsWrappers -> isGoogleNewsWrapperUrl, headlineFingerprint
4530-4743 PUBLIC buildCluster -> dedupeGoogleNewsWrappers, safeDate, chooseRepresentative, isGenuinelyRelated, VALID_SMART_CATEGORIES, isInvestingComSource, isVietnameseArticle, stableId, canonicalSourceIdentity, calculateHotness
4745-4856 PUBLIC attachBroaderStoryMetadata -> getArticleId, stableId, safeDate
4860-4887 PUBLIC buildEarlySmartClusters -> detectEventConflicts, titleTokens, safeDate, HOUR_MS, tokenSimilarity, tokenOverlapCount, isGenuinelyRelated, retainStoryIds, buildCluster
4889-4973 PUBLIC cleanStoredCluster -> detectEventConflicts, isGenuinelyRelated
4975-5052 buildVerificationPrompt -> getArticleId, detectArticleLanguage
5054-5122 PUBLIC buildComponentReviewUnits -> getArticleId, chooseRepresentative, safeDate, stableId
5124-5179 buildComponentReviewPrompt -> 
5181-5266 PUBLIC validateComponentReviewResult -> 
5268-5302 PUBLIC expandComponentReviewDecision -> 
5304-5309 parsePartitionResponse -> parseClusteringJson
5311-5420 PUBLIC validatePartitionResult -> getArticleId
5422-5482 pairEligibleForVerifiedCluster -> detectEventConflicts, cosineSimilarity, classifyE5Match, MatchDecision, isAiRecoveryReviewCandidate, tokenOverlapCount, tokenSimilarity
5484-5584 postValidatePartition -> getArticleId, detectEventConflicts, pairEligibleForVerifiedCluster
5586-5592 RAW_PROVIDER_DIAGNOSTIC_LIMIT -> 
5594-5614 sanitizeProviderDiagnosticText -> RAW_PROVIDER_DIAGNOSTIC_LIMIT
5616-5655 providerJsonDiagnosticFields -> sanitizeProviderDiagnosticText
5657-5678 sanitizeProviderErrorMessage -> 
5680-5704 normalizeProviderError -> sanitizeProviderErrorMessage
5706-5723 isTransientProviderError -> 
5725-5772 providerEnabled -> antigravityAvailable, geminiWebConfigured
5774-5774 preferredClusteringModel -> 
5775-5777 PUBLIC setClusteringModel -> preferredClusteringModel
5779-5809 getEnabledVerificationProviders -> SMART_NEWS_AI_CONFIG, providerEnabled, preferredClusteringModel
5811-5824 getProviderHealth -> 
5826-5894 updateProviderHealth -> providerHealthWriteChain, getProviderHealth
5896-5910 recordProviderAttempt -> updateProviderHealth
5912-5930 recordProviderSuccess -> updateProviderHealth
5932-5987 recordProviderCooldown -> updateProviderHealth, sanitizeProviderErrorMessage
5989-6025 recordProviderError -> normalizeProviderError, updateProviderHealth
6027-6209 requestGeminiPartition -> buildVerificationPrompt, PARTITION_RESPONSE_SCHEMA, parsePartitionResponse
6210-6266 assertLocalModelAvailable -> localModelAvailabilityCache, LOCAL_MODEL_AVAILABILITY_TTL_MS
6268-6385 requestLocalPartition -> withLocalCompute, assertLocalModelAvailable, buildVerificationPrompt, PARTITION_RESPONSE_SCHEMA, LOCAL_AI_KEEP_ALIVE, LOCAL_AI_CONTEXT_TOKENS, LOCAL_AI_OUTPUT_TOKENS, parsePartitionResponse
6387-6405 providerReviewArticleLimit -> SMART_NEWS_CLUSTER_CONFIG
6408-6426 providerReviewComponentLimit -> SMART_NEWS_CLUSTER_CONFIG
6428-6475 extractCompleteJsonRoots -> 
6477-6572 normalizeAntigravityDecision -> 
6574-6648 PUBLIC normalizeAntigravityClusteringOutput -> extractCompleteJsonRoots, normalizeAntigravityDecision
6650-6700 normalizeAntigravityComponentDecision -> 
6702-6747 normalizeAntigravityComponentOutput -> extractCompleteJsonRoots, normalizeAntigravityComponentDecision
6749-6783 isModelOutputError -> 
6785-6990 callVerificationProvider -> buildVerificationPrompt, PARTITION_RESPONSE_SCHEMA, generateWithAntigravity, normalizeAntigravityComponentOutput, normalizeAntigravityClusteringOutput, generateWithGeminiWeb, acquireGeminiKey, requestGeminiPartition, providerReviewComponentLimit, providerReviewArticleLimit, requestLocalPartition
6993-7737 assessSmartEditorialClusters -> prepareSmartEditorialPlan, freshestPublishedAt, buildSmartEditorialPrompt, runGlobalAiTask, callVerificationProvider, SMART_EDITORIAL_RESPONSE_SCHEMA, parseSmartEditorialResponse, getGeminiWebCooldownState, sleep, recordProviderAttempt, recordProviderSuccess, recordProviderCooldown, recordProviderError, isModelOutputError, isTransientProviderError, SMART_EDITORIAL_POLICY_VERSION, applySmartEditorialAssessment
7739-8598 attemptProviderVerification -> providerReviewArticleLimit, recordProviderAttempt, requestClusteringDecision, callVerificationProvider, validatePartitionResult, PARTITION_RESPONSE_SCHEMA, sanitizeProviderDiagnosticText, recordProviderError, getArticleId, detectEventConflicts, pairEligibleForVerifiedCluster, postValidatePartition, recordProviderSuccess, providerJsonDiagnosticFields, recordProviderCooldown, isModelOutputError, isTransientProviderError, sleep
8600-8617 componentVerificationCacheKey -> SMART_CLUSTER_VERSION, createHash
8619-8647 getCachedComponentVerificationDecision -> SMART_NEWS_AI_CONFIG, getVerificationCache, componentVerificationCacheKey, validateComponentReviewResult, expandComponentReviewDecision, validatePartitionResult, postValidatePartition
8649-8677 setCachedComponentVerificationDecision -> SMART_NEWS_AI_CONFIG, validateComponentReviewResult, verificationCacheWriteChain, getVerificationCache, componentVerificationCacheKey
8679-8958 attemptComponentProviderVerification -> providerReviewComponentLimit, buildComponentReviewPrompt, COMPONENT_REVIEW_RESPONSE_SCHEMA, recordProviderAttempt, requestClusteringDecision, callVerificationProvider, validateComponentReviewResult, expandComponentReviewDecision, validatePartitionResult, postValidatePartition, recordProviderSuccess, recordProviderCooldown, recordProviderError, isModelOutputError, isTransientProviderError, sleep
8960-9351 verifyComponentReviewWithProviderChain -> globalAiTaskActive, runGlobalAiTask, freshestPublishedAt, getCachedComponentVerificationDecision, providerReviewComponentLimit, getGeminiWebCooldownState, providerDeferredError, attemptComponentProviderVerification, setCachedComponentVerificationDecision
9353-9359 normalizedVerificationArticles -> getArticleId, detectArticleLanguage
9361-9401 PUBLIC verificationCacheKey -> normalizedVerificationArticles, SMART_NEWS_AI_CONFIG, SMART_CLUSTER_VERSION, createHash
9403-9416 getVerificationCache -> 
9418-9475 PUBLIC getCachedVerificationDecision -> SMART_NEWS_AI_CONFIG, getVerificationCache, verificationCacheKey, validatePartitionResult, postValidatePartition
9477-9541 PUBLIC setCachedVerificationDecision -> SMART_NEWS_AI_CONFIG, validatePartitionResult, postValidatePartition, verificationCacheWriteChain, getVerificationCache, verificationCacheKey
9543-10047 PUBLIC verifyWithProviderChain -> globalAiTaskActive, runGlobalAiTask, freshestPublishedAt, providerReviewArticleLimit, buildComponentReviewUnits, verifyComponentReviewWithProviderChain, getCachedVerificationDecision, verificationCacheKey, getGeminiWebCooldownState, providerDeferredError, attemptProviderVerification, setCachedVerificationDecision
10050-10174 PUBLIC prepareIncrementalReviewGroups -> getArticleId, detectEventConflicts, createGroupId
10176-10223 PUBLIC integrateIncrementalReviews -> getArticleId, postValidatePartition
10225-10628 reviewAmbiguousEventGroups -> getHeapStatistics, verifyWithProviderChain, deferredReviewPartitions, getArticleId, createGroupId
10630-10689 assertEveryCandidateAppearsExactlyOnce -> getArticleId
10691-10705 getClusterArticleLinks -> 
10707-10722 getLatestClusterCoverageTime -> parsePublishedTimestamp
10724-10752 mergeRelatedDevelopmentRelationships -> 
10754-10780 deferredReviewPartitions -> createGroupId
10782-10935 PUBLIC buildPublicationClusterSnapshot -> integrateIncrementalReviews, assertEveryCandidateAppearsExactlyOnce, buildCluster, DAY_MS, getClusterArticleLinks, getLatestClusterCoverageTime, cleanStoredCluster, safeDate, retainStoryIds, getArticleId, attachBroaderStoryMetadata
10937-10949 isActiveCluster -> getLatestClusterCoverageTime, HOUR_MS
10951-11020 extractActiveClusterArticles -> getLatestClusterCoverageTime, stableId, getClusterArticleLinks, hostFromUrl, detectArticleLanguage
11022-11094 fetchRssUrl -> discardResponseBody, SMART_ITEMS_PER_SOURCE
11096-11157 fetchSmartSource -> fetchRssUrl, normalizeArticle
11159-11206 fetchInBatches -> 
11208-11230 putManySafe -> 
11232-11242 hasOnlyOpenCliFetchMethod -> 
11244-11254 smartArticleIdentity -> 
11256-11267 prefetchOpenCliOnlySmartArticles -> hasOnlyOpenCliFetchMethod, smartArticleIdentity
11269-11393 PUBLIC startSmartSyncLoop -> sleep, activeSmartEngineRefreshes, hasWorkerHeadroom, fetchInBatches, fetchSmartSource, prefetchOpenCliOnlySmartArticles
11395-11515 PUBLIC scheduleMonthlySourceEvaluation -> DAY_MS, HOUR_MS
11517-14370 PUBLIC createSmartNewsEngine -> getClusterWorker, SMART_NEWS_AI_CONFIG, toVietnamIso, DEFAULT_SMART_SOURCES, hostFromUrl, normalizeSmartSource, canonicalSourceUrl, sourceFetchPolicyIdentity, canonicalSmartCategory, SMART_SOURCE_FETCH_METHODS, VALID_SMART_CATEGORIES, SMART_SOURCE_DISCOVERY_POOL, getEnabledVerificationProviders, getProviderHealth, providerEnabled, SMART_REFRESH_MS, countSmartSources, activeSmartEngineRefreshes, isInvestingComSource, fetchInBatches, fetchSmartSource, SMART_CLUSTER_VERSION, SMART_NEWS_CLUSTER_CONFIG, HOUR_MS, isActiveCluster, extractActiveClusterArticles, isExcludedFromSmart, parsePublishedTimestamp, normalizeArticle, dedupeGoogleNewsWrappers, normalizeBlockedKeywordEntries, articleContentFilterMatches, createHash, buildEmbeddingText, normalizedVerificationArticles, stableId, EMBEDDING_MODEL, EMBEDDING_CACHE_VERSION, withLocalCompute, EMBEDDING_CACHE_FILE, getArticleId, prepareIncrementalReviewGroups, deferredReviewPartitions, getHeapStatistics, mergeRelatedDevelopmentRelationships, buildPublicationClusterSnapshot, createGroupId, reviewAmbiguousEventGroups, assessSmartEditorialClusters, putManySafe, getVerificationCache, embeddingCache, disposeEmbeddingModel
ENGINE FUNCTIONS
11588-11600 getSettings -> db
11602-11619 updateSettings -> getSettings, db
11621-11810 getSourceSettings -> db, DEFAULT_SMART_SOURCES, hostFromUrl, normalizeSmartSource, canonicalSourceUrl, sourceFetchPolicyIdentity
11812-11833 getSources -> getSettings, getSourceSettings
11835-11901 addSource -> canonicalSmartCategory, normalizeSmartSource, getSourceSettings, sourceFetchPolicyIdentity, canonicalSourceUrl, db
11903-11965 setSourceEnabled -> canonicalSourceUrl, getSourceSettings, db
11967-11972 removeSource -> setSourceEnabled
11974-11987 updateSourceFetchMethodsByIdentity -> sourceFetchPolicyIdentity, SMART_SOURCE_FETCH_METHODS, db
11989-11992 setSourceFetchMethodsByIdentity -> getSourceSettings, updateSourceFetchMethodsByIdentity
11994-12001 setSourceFetchMethods -> canonicalSourceUrl, getSourceSettings, updateSourceFetchMethodsByIdentity
12003-12102 discoverSources -> canonicalSmartCategory, VALID_SMART_CATEGORIES, getSourceSettings, canonicalSourceUrl, SMART_SOURCE_DISCOVERY_POOL, normalizeSmartSource, db
12104-12136 resetSources -> getSourceSettings, sourceFetchPolicyIdentity, DEFAULT_SMART_SOURCES, normalizeSmartSource, db
12138-12269 getStatus -> db, getSources, getEnabledVerificationProviders, hasGeminiKey, getProviderHealth, SMART_NEWS_AI_CONFIG, providerEnabled, running, currentProgress, SMART_REFRESH_MS, countSmartSources, localModel
12271-12276 setStatus -> db
12278-14290 sync -> canonicalSmartCategory, running, activeSmartEngineRefreshes, toVietnamIso, VALID_SMART_CATEGORIES, currentProgress, getSources, countSmartSources, db, getEnabledVerificationProviders, hasGeminiKey, setStatus, localModel, isInvestingComSource, fetchInBatches, fetchSmartSource, helpers, headers, SMART_CLUSTER_VERSION, getSettings, canonicalSourceUrl, SMART_NEWS_CLUSTER_CONFIG, HOUR_MS, isActiveCluster, extractActiveClusterArticles, isExcludedFromSmart, parsePublishedTimestamp, normalizeArticle, dedupeGoogleNewsWrappers, normalizeBlockedKeywordEntries, articleContentFilterMatches, createHash, buildEmbeddingText, normalizedVerificationArticles, stableId, EMBEDDING_MODEL, EMBEDDING_CACHE_VERSION, SMART_NEWS_AI_CONFIG, clusterWorkerFactory, withLocalCompute, EMBEDDING_CACHE_FILE, getArticleId, prepareIncrementalReviewGroups, deferredReviewPartitions, getHeapStatistics, mergeRelatedDevelopmentRelationships, buildPublicationClusterSnapshot, createGroupId, reviewAmbiguousEventGroups, keyManager, assessSmartEditorialClusters, putManySafe, getProviderHealth, getVerificationCache, embeddingCache, disposeEmbeddingModel
14292-14309 scheduleNext -> timer, helpers, sync, SMART_REFRESH_MS
14311-14352 start -> helpers, sync, scheduleNext, getSources, getEnabledVerificationProviders, hasGeminiKey
```

## Database operations (original line numbers)

| Line | Operation | Key or bulk keys |
| --- | --- | --- |
| 5814 | get | smartAiProviderHealth |
| 5879 | put | smartAiProviderHealth |
| 7009 | get | smartEditorialAssessmentCache |
| 7728 | put | smartEditorialAssessmentCache |
| 8669 | put | smartEventVerificationCache |
| 9406 | get | smartEventVerificationCache |
| 9524 | put | smartEventVerificationCache |
| 9658 | get | smartVerificationFailures |
| 9984 | put | smartVerificationFailures |
| 9996 | put | smartVerificationFailures |
| 11217 | putMany | values |
| 11228 | put | key |
| 11361 | put | smartRawArticles |
| 11414 | get | lastSourceEvalTime |
| 11423 | get | smartSourceScores |
| 11469 | put | smartSourceScores |
| 11476 | put | lastSourceEvalTime |
| 11590 | get | smartSettings |
| 11613 | put | smartSettings |
| 11623 | get | smartSources |
| 11760 | put | smartSources |
| 11775 | get | smartSourceScores |
| 11895 | put | smartSources |
| 11959 | put | smartSources |
| 11985 | put | smartSources |
| 12093 | put | smartSources |
| 12130 | put | smartSources |
| 12141 | get | smartStatus |
| 12236 | get | smartClusteringCounters |
| 12272 | put | smartStatus |
| 12412 | get | smartStatus |
| 12465 | get | smartRawArticles |
| 12573 | put | smartRawArticles |
| 12582 | get | articles |
| 12595 | get | smartClusters |
| 12607 | get | smartDeferredReviewGroups |
| 12620 | get | feeds |
| 12758 | get | blockedArticleKeywords |
| 12793 | get | smartClusteringInputs |
| 12793 | get | smartRawArticles |
| 12910 | get | smartCandidateSignature |
| 12942 | get | smartAiConfig |
| 12949 | get | smartClusteringFailedAttempt |
| 12962 | get | smartClusteringAlgorithmVersion |
| 12963 | get | smartEmbeddingIdentity |
| 13023 | get | smartClusteringAlgorithmVersion |
| 13029 | get | smartEmbeddingIdentity |
| 13395 | put | smartProgressivePublication |
| 13400 | put | smartProgressiveClusterState |
| 13556 | put | smartProgressivePublication |
| 13560 | put | smartProgressiveClusterState |
| 14209 | put | smartClusteringFailedAttempt |
| 14257 | get | smartClusteringCounters |
| 14261 | put | smartClusteringCounters |

## Environment variables

- SMART_EMBEDDING_MODEL: original line 43.
- SMART_EMBEDDING_CACHE_FILE: original line 46.
- ANTIGRAVITY_MEDIUM_MODEL: original line 109.
- ANTIGRAVITY_HIGH_MODEL: original line 119.
- GEMINI_FLASH_LITE_MODEL: original line 132.
- GEMINI_MODEL: original line 153.
- OLLAMA_SMART_MODEL: original line 165.
- OLLAMA_BASE_URL: original line 168.
- SMART_LOCAL_AI_TIMEOUT_MS: original line 175.
- SMART_LOCAL_AI_NUM_CTX: original line 197.
- SMART_LOCAL_AI_NUM_PREDICT: original line 205.
- SMART_LOCAL_AI_KEEP_ALIVE: original line 210.
- SMART_EMBEDDING_BATCH_SIZE: original line 216.
- SMART_EMBEDDING_JOB_TIMEOUT_MS: original line 1865.
- SMART_PROGRESS_THROTTLE_MS: original line 1931.
- SMART_AI_RAW_LOG_MAX_CHARS: original line 5590.
- SMART_ONLY_LOCAL: original line 5734.
- USE_GEMINI: original line 5738.
- SMART_LOCAL_AI_ENABLED: original line 5743.
- SMART_EDITORIAL_PER_DESTINATION: original line 7024.
- SMART_EDITORIAL_BATCH_SIZE: original line 7036.
- SMART_EDITORIAL_LOCAL_BATCH_SIZE: original line 7048.
- SMART_LOG_AI_DEBUG: original line 7804.
- SMART_LOG_GEMINI_RESPONSES: original line 8280.
- SMART_VERIFY_FAILURE_RETRY_MS: original line 9663.
- SMART_AI_REVIEW_HEAP_DEFER_MB: original line 10252.
- GEMINI_API_KEY: original line 11525.
- SMART_CLUSTERING_MODE: original line 13165.
- SMART_PROGRESSIVE_MAX_CANDIDATES: original line 13313.
- SMART_PROGRESSIVE_PUBLISH_HEAP_MAX_MB: original line 13361.
- SMART_EMBEDDING_WORKER_IDLE_MS: original line 14277.

Configuration constants evaluate at module initialization; function-local settings remain evaluated at call time. Preserve defaults, bounds and parsing expressions verbatim.

## Dynamic imports and timers

- Dynamic import ./summary-engine.js at line 11401; retain repository-root resolution after moving.
- Line 438: setTimeout(resolve, ms)
- Line 1868: setTimeout(() => { workerPromises.delete(id); reject(new Error('Embedding worker job timeout')); }, timeoutMs)
- Line 1952: setTimeout(r, 50)
- Line 6051: setTimeout( () => controller.abort(), timeoutMs )
- Line 6235: setTimeout(() => controller.abort(), 3000)
- Line 6285: setTimeout( () => controller.abort(), timeoutMs )
- Line 11031: setTimeout( () => controller.abort(), 18_000 )
- Line 11497: setTimeout( checkEvaluation, 10_000 )
- Line 11503: setInterval( checkEvaluation, HOUR_MS )
- Line 14279: setTimeout(() => { if (!running) { disposeEmbeddingModel(); } }, idleMs)
- Line 14295: setTimeout( async () => { if (typeof helpers.waitForHttpIdle === 'function') { await helpers.waitForHttpIdle(); } await sync(); scheduleNext(); }, SMART_REFRESH_MS )
- Line 14313: setTimeout( async () => { if (typeof helpers.waitForHttpIdle === 'function') { await helpers.waitForHttpIdle(); } await sync(); }, 2500 )

## Mutable state and lifecycle ownership

- Embeddings: private cache, legacy embeddingPipeline binding, worker, message counter and pending promises; persistent worker and unchanged native addon failure behavior.
- Clustering worker: private singleton; fatal error or exit schedules whole-process exit rather than replacement.
- Text: private batch stop-token set.
- Provider health: private serialized write chain.
- Verification cache: private serialized write chain shared by partition and component decisions.
- Verification execution: private local-model availability cache and original TTL.
- Provider configuration: private preferred clustering model.
- Refresh coordination: private active-refresh count shared with background sync through behavior methods.
- Each engine: running flag, scheduling timer and progress.
- Each refresh: candidate/source arrays, review graph and progressive baseline/resolved maps. Explicit release order before editorial/persistence/ready notification is behavior.

## Repository callers and test references

```text
./ops/maintenance/cleanup-live-tree.sh:23:        .env|.gitignore|README.md|article-media.js|database.json|database-state.json|database.json.backup|database.writer.lock|feed-parsers.js|feed-worker.js|feeds_backup.json|feeds_backup.json.backup|gemini.env|gemini-keys.txt|index.html|package-lock.json|package.json|qwen-keys.txt|script.js|server.js|smart-cluster-worker.js|smart-state.json|smart-data.json|smart-data.json.backup|smart-embedding-worker.js|smart-embeddings-worker.json|smart-hnsw-clustering.js|smart-news.js|smart-sources.js|summary-engine.js|tailwind.config.js)
./ops/backup/backup-my-rss-reader.sh:94:    smart-news.js
./smart-cluster-worker.js:11:} from './smart-news.js';
./smart-hnsw-clustering.js:7:} from './smart-news.js';
./test/google-news-resolution.test.js:9:const smartNews = readFileSync(new URL('../smart-news.js', import.meta.url), 'utf8');
./test/story-briefing.test.js:118:    const { buildEarlySmartClusters } = await import('../smart-news.js');
./test/smart-navigation-performance.test.js:10:import { getSmartDestinationPartition, normalizeArticle } from '../smart-news.js';
./test/antigravity.test.js:84: const smart=await readFile(new URL('../smart-news.js',import.meta.url),'utf8');
./test/clustering-json.test.js:4:import { validatePartitionResult, getArticleId } from '../smart-news.js';
./test/smart-clustering-reuse.test.js:8:} from '../smart-news.js';
./test/smart-clustering-reuse.test.js:45:  try { const other = await import('../smart-news.js?model-identity-fixture'); assert.notEqual(embeddingCacheKey(article), other.embeddingCacheKey(article)); }
./test/project-layout.test.js:36:    'smart-news.js',
./test/gemini-availability.test.js:4:import { verifyWithProviderChain } from '../smart-news.js';
./src/ai/local-compute.js:9:// smart-news.js documents that onnxruntime-node 1.14.0 cannot safely recreate
./test/smart-embedding-cache.test.js:13:    const writer = await import(`../smart-news.js?embedding-writer=${Date.now()}`);
./test/smart-embedding-cache.test.js:32:    const reader = await import(`../smart-news.js?embedding-reader=${Date.now()}`);
./test/online-ai-policy.test.js:21:        read('smart-news.js'),
./test/online-ai-policy.test.js:33:    const smartSource = await read('smart-news.js');
./test/online-ai-policy.test.js:44:    const smartSource = await read('smart-news.js');
./test/smart-clustering-sync.test.js:4:import { createSmartNewsEngine } from '../smart-news.js';
./test/smart-component-review.test.js:11:} from '../smart-news.js';
./test/smart-news.test.js:3:import { createSmartNewsEngine } from '../smart-news.js';
./test/smart-news.test.js:73:    const { sourceFetchPolicyIdentity } = await import('../smart-news.js');
./test/smart-news.test.js:83:    const { calculateHotness, canonicalSourceIdentity } = await import('../smart-news.js');
./test/smart-news.test.js:99:    } = await import('../smart-news.js');
./test/smart-news.test.js:142:    } = await import('../smart-news.js');
./test/smart-news.test.js:184:    const { dedupeGoogleNewsWrappers } = await import('../smart-news.js');
./test/smart-news.test.js:201:    const { normalizeArticle } = await import('../smart-news.js');
./test/smart-news.test.js:218:    const { buildCluster } = await import('../smart-news.js');
./test/smart-news.test.js:269:    } = await import('../smart-news.js');
./test/smart-news.test.js:341:    } = await import('../smart-news.js');
./test/mobile-ui.test.js:75:    const smartNews = readFileSync(new URL('../smart-news.js', import.meta.url), 'utf8');
./test/fetch-method-policy.test.js:72:    const smartNews = readFileSync(new URL('../smart-news.js', import.meta.url), 'utf8');
./test/smart-progressive-publication.test.js:134:  const source = await readFile(new URL('../smart-news.js', import.meta.url), 'utf8');
./test/smart-refactor-golden.test.js:4:import * as smart from '../smart-news.js';
./src/database/store.js.bak-ai-editorial-final-20260915-194527:5:import { calculateHotness } from '../../smart-news.js';
./src/database/store.js:6:import { calculateHotness } from '../../smart-news.js';
./src/database/store.js.bak-ai-editorial-20260915-193054:5:import { calculateHotness } from '../../smart-news.js';
./src/app.js.bak-global-scheduler-20260918-211125:9:import { createSmartNewsEngine } from '../smart-news.js';
./src/routes/settings-routes.js:2:import { setClusteringModel } from '../../smart-news.js';
./src/routes/content-filter-routes.js.bak-content-filter-heavy-v2-1790009005:3:import { cleanStoredCluster } from '../../smart-news.js';
./src/routes/content-filter-routes.js:3:import { cleanStoredCluster } from '../../smart-news.js';
./src/routes/settings-routes.js.bak-smart-global-20260922-001235:2:import { setClusteringModel } from '../../smart-news.js';
./src/routes/content-filter-routes.js.bak-content-filter-cheap-v5-1790017562:3:import { cleanStoredCluster } from '../../smart-news.js';
./src/routes/feed-routes.js:4:import { sourceFetchPolicyIdentity } from '../../smart-news.js';
./src/routes/data-routes.js.bak-smart-global-20260922-001235:5:import { cleanStoredCluster, calculateHotness } from '../../smart-news.js';
./src/routes/data-routes.js.bak-top-dedupe-20260922-013733:5:import { cleanStoredCluster, calculateHotness } from '../../smart-news.js';
./src/routes/data-routes.js:5:import { cleanStoredCluster, calculateHotness } from '../../smart-news.js';
./src/app.js.bak-global-scheduler-20260918-210709:9:import { createSmartNewsEngine } from '../smart-news.js';
./src/jobs/startup.js:1:import { setClusteringModel, startSmartSyncLoop } from '../../smart-news.js';
./src/app.js:11:import { createSmartNewsEngine } from '../smart-news.js';
./src/articles/presentation.js.bak-top-dedupe-20260922-013733:12:import { cleanStoredCluster, calculateHotness, buildCluster } from '../../smart-news.js';
./src/articles/story-briefing.js.bak-deferred-v4-20260919-020429:476:     * global scheduler from smart-news.js.
./src/articles/presentation.js.bak-snapshot-view-1789719565:12:import { cleanStoredCluster, calculateHotness, buildCluster } from '../../smart-news.js';
./src/articles/presentation.js.bak-smart-global-20260922-001235:12:import { cleanStoredCluster, calculateHotness, buildCluster } from '../../smart-news.js';
./src/articles/presentation.js.bak-deferred-20260919-020004:12:import { cleanStoredCluster, calculateHotness, buildCluster } from '../../smart-news.js';
./src/articles/presentation.js:14:import { cleanStoredCluster, calculateHotness, buildCluster } from '../../smart-news.js';
./src/articles/fetch-policy.js:3:import { sourceFetchPolicyIdentity } from '../../smart-news.js';
./src/articles/presentation.js.bak-fresh-top-1789719898:12:import { cleanStoredCluster, calculateHotness, buildCluster } from '../../smart-news.js';
./src/articles/presentation.js.bak-deferred-v4-20260919-020429:12:import { cleanStoredCluster, calculateHotness, buildCluster } from '../../smart-news.js';
./src/articles/fetch-policy.js.bak-fast-save-1789672727:2:import { sourceFetchPolicyIdentity } from '../../smart-news.js';
./src/articles/story-briefing.js.bak-deferred-20260919-020004:476:     * global scheduler from smart-news.js.
./src/articles/story-briefing.js.bak-deferred-v2-20260919-020125:476:     * global scheduler from smart-news.js.
./src/articles/fetch-policy.js.bak-20260917-181808:2:import { sourceFetchPolicyIdentity } from '../../smart-news.js';
./src/articles/presentation.js.bak-smart-global-final-20260922-001336:12:import { cleanStoredCluster, calculateHotness, buildCluster } from '../../smart-news.js';
./src/articles/fetch-policy.js.bak-opencli-fetch-20260917-181440:2:import { sourceFetchPolicyIdentity } from '../../smart-news.js';
./src/articles/presentation.js.bak-deferred-v2-20260919-020125:12:import { cleanStoredCluster, calculateHotness, buildCluster } from '../../smart-news.js';
./src/articles/presentation.js.bak-fresh-top-1789719812:12:import { cleanStoredCluster, calculateHotness, buildCluster } from '../../smart-news.js';
./src/feeds/prefetch.js:6:import { cleanStoredCluster } from '../../smart-news.js';
./src/feeds/prefetch.js.bak-smart-global-20260922-001235:6:import { cleanStoredCluster } from '../../smart-news.js';
```

Backup references are historical only. Production consumers keep the facade import path. HNSW requires a minimal downward import change to remove the existing facade cycle. Source-inspection tests must follow moved owners; environment reinitialization tests must use a fresh process instead of cache-busting a facade whose owners are singletons.

## Baseline

Full suite: 90 files, 88 passing, two existing failures (project-layout rejects the pre-existing .aws directory; server-http subprocess fails in the restricted environment). Golden fixture captured from the untouched implementation: 14 articles across six destinations, duplicate/bilingual/related/ambiguous coverage and an unreliable date. It includes all normalized fields/hashes, embedding and verification keys, all pair decisions, deterministic and native HNSW output, publication membership, relationships, cache decisions and editorial application. Golden rerun passed before extraction.
