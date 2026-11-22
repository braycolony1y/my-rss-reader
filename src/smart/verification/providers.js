import { extendAiReview, normalizeWithSideTask, requestWithOptionalSideTask } from '../prefilter/ai.js';
import { generateWithAntigravity } from '../../ai/antigravity.js';
import { acquireGeminiKey } from '../../ai/gemini-availability.js';
import { generateWithGeminiWeb } from '../../ai/gemini-web.js';
import { withLocalCompute } from '../../ai/local-compute.js';
import { LOCAL_MODEL_AVAILABILITY_TTL_MS, LOCAL_AI_KEEP_ALIVE, LOCAL_AI_CONTEXT_TOKENS, LOCAL_AI_OUTPUT_TOKENS } from '../config.js';
import { buildVerificationPrompt } from './prompts.js';
import { providerReviewComponentLimit, providerReviewArticleLimit } from './provider-config.js';
import { PARTITION_RESPONSE_SCHEMA } from './schemas.js';
import { parsePartitionResponse } from './validation.js';

const localModelAvailabilityCache = new Map();

async function requestGeminiPartition(
  articles,
  apiKey,
  model,
  timeoutMs,
  keyIndex,
  generationOptions = {}
) {
  if (!apiKey) {
    const error =
      new Error(
        'No Gemini API key available'
      );

    error.code =
      'NOT_CONFIGURED';

    throw error;
  }

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => controller.abort(),
      timeoutMs
    );

  try {
    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

    generationOptions.onRequest?.();
    const response =
      await fetch(endpoint, {
        method: 'POST',

        headers: {
          'Content-Type':
            'application/json',
          'x-goog-api-key':
            apiKey
        },

        signal:
          controller.signal,

        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text:
                    generationOptions.repairPrompt ||
                    generationOptions.prompt ||
                    buildVerificationPrompt(articles)
                }
              ]
            }
          ],

          generationConfig: {
            maxOutputTokens:
              Math.max(
                256,
                Math.min(
                  4096,
                  Number(
                    generationOptions
                      .maxOutputTokens
                  ) || 1024
                )
              ),
            thinkingConfig: {
              thinkingLevel:
                generationOptions
                  .thinkingLevel ||
                'low'
            },
            responseMimeType:
              'application/json',
            responseJsonSchema:
              generationOptions.schema ||
              PARTITION_RESPONSE_SCHEMA
          }
        })
      });

    if (!response.ok) {
      const details =
        await response
          .text()
          .catch(() => '');

      const error =
        new Error(
          `Gemini HTTP ${response.status}: ${details.slice(0, 300)}`
        );

      error.status =
        response.status;
      error.keyIndex =
        Number(keyIndex) || null;

      throw error;
    }

    const payload =
      await response.json();

    const text =
      payload?.candidates?.[0]
        ?.content?.parts
        ?.map(
          part =>
            part.text || ''
        )
        .join('') || '';

    if (!text && !generationOptions.rawOutput) {
      throw new Error(
        'Gemini returned an empty response'
      );
    }

    if (generationOptions.rawOutput) return { text, onlineAiUsage: {
      keyIndex: Number(keyIndex) || null, httpStatus: response.status,
      promptTokens: Number(payload?.usageMetadata?.promptTokenCount) || 0,
      outputTokens: Number(payload?.usageMetadata?.candidatesTokenCount) || 0,
      totalTokens: Number(payload?.usageMetadata?.totalTokenCount) || 0
    } };
    const parsed = parsePartitionResponse(
      text,
      model
    );

    parsed.onlineAiUsage = {
      keyIndex:
        Number(keyIndex) || null,
      httpStatus:
        response.status,
      promptTokens:
        Number(
          payload?.usageMetadata
            ?.promptTokenCount
        ) || 0,
      outputTokens:
        Number(
          payload?.usageMetadata
            ?.candidatesTokenCount
        ) || 0,
      totalTokens:
        Number(
          payload?.usageMetadata
            ?.totalTokenCount
        ) || 0
    };

    return parsed;
} catch (error) {
  /*
   * Bind every request-level failure to the exact Gemini key that
   * started this HTTP request.
   *
   * Covers fetch/network failures, abort timeouts, JSON parsing,
   * empty responses, and HTTP errors.
   */
  if (
    error &&
    typeof error === 'object' &&
    !Number(error.keyIndex)
  ) {
    error.keyIndex =
      Number(keyIndex) || null;
  }

  throw error;
} finally {
  clearTimeout(timeout);
}
}

async function assertLocalModelAvailable(
  baseUrl,
  model
) {
  const normalizedBaseUrl =
    String(baseUrl).replace(/\/$/, '');
  const cacheKey =
    `${normalizedBaseUrl}|${model}`;
  const cached =
    localModelAvailabilityCache.get(cacheKey);

  if (
    cached &&
    Date.now() - cached.checkedAt < LOCAL_MODEL_AVAILABILITY_TTL_MS
  ) {
    if (!cached.available) {
      const error = new Error(`Local AI model '${model}' is not installed`);
      error.code = 'LOCAL_MODEL_UNAVAILABLE';
      error.nonProviderFault = true;
      throw error;
    }
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(`${normalizedBaseUrl}/api/tags`, {
      signal: controller.signal
    });
    if (!response.ok) return;

    const payload = await response.json();
    if (!Array.isArray(payload?.models)) return;

    const available = payload.models.some(entry =>
      String(entry?.name || entry?.model || '') === String(model)
    );
    localModelAvailabilityCache.set(cacheKey, {
      available,
      checkedAt: Date.now()
    });

    if (!available) {
      const error = new Error(`Local AI model '${model}' is not installed`);
      error.code = 'LOCAL_MODEL_UNAVAILABLE';
      error.nonProviderFault = true;
      throw error;
    }
  } catch (error) {
    if (error?.code === 'LOCAL_MODEL_UNAVAILABLE') throw error;
    // Availability probing is advisory. If Ollama does not expose /api/tags
    // cleanly, let the normal /api/chat request decide provider availability.
  } finally {
    clearTimeout(timeout);
  }
}

async function requestLocalPartition(
  articles,
  baseUrl,
  model,
  timeoutMs,
  repairPrompt = null,
  rawOutput = false,
  onRequest = null,
  generationOptions = {}
) {
  return withLocalCompute(
    `qwen:${model}`,
    async () => {
  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => controller.abort(),
      timeoutMs
    );

  try {
    await assertLocalModelAvailable(
      baseUrl,
      model
    );

    const endpoint =
      `${String(baseUrl).replace(/\/$/, '')}/api/chat`;

    onRequest?.();
    const response =
      await fetch(endpoint, {
        method: 'POST',

        headers: {
          'Content-Type':
            'application/json'
        },

        signal:
          controller.signal,

        body: JSON.stringify({
          model,

          messages: [
            {
              role: 'user',
              content:
                repairPrompt ||
                generationOptions.prompt ||
                buildVerificationPrompt(articles)
            }
          ],

          stream: false,
          think: false,
          format:
            generationOptions.schema ||
            PARTITION_RESPONSE_SCHEMA,
          keep_alive:
            LOCAL_AI_KEEP_ALIVE,

          options: {
            temperature: 0,
            num_ctx:
              LOCAL_AI_CONTEXT_TOKENS,
            num_predict:
              LOCAL_AI_OUTPUT_TOKENS,
            seed: 17
          }
        })
      });

    if (!response.ok) {
      const details =
        await response
          .text()
          .catch(() => '');

      const error =
        new Error(
          `Local AI HTTP ${response.status}: ${details.slice(0, 300)}`
        );

      error.status =
        response.status;

      throw error;
    }

    const payload =
      await response.json();

    const text =
      payload?.message?.content ||
      '';

    if (!text && !rawOutput) {
      throw new Error(
        'Local AI returned an empty response'
      );
    }

    if (rawOutput) return text;
    return parsePartitionResponse(
      text,
      model
    );
  } finally {
    clearTimeout(timeout);
  }

    }
  );
}

function extractCompleteJsonRoots(text) {
  const roots = [];
  let start = -1;
  let stack = [];
  let quoted = false;
  let escaped = false;

  for (let index = 0; index < text.length; index++) {
    const character = text[index];

    if (start < 0) {
      if (character === '{' || character === '[') {
        start = index;
        stack = [character];
      }
      continue;
    }

    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }

    if (character === '"') {
      quoted = true;
      continue;
    }

    if (character === '{' || character === '[') {
      stack.push(character);
      continue;
    }

    if (character !== '}' && character !== ']') continue;

    const expected = character === '}' ? '{' : '[';
    if (stack.pop() !== expected) return [];

    if (!stack.length) {
      roots.push(text.slice(start, index + 1));
      start = -1;
    }
  }

  return start < 0 ? roots : [];
}

function normalizeAntigravityDecision(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !Array.isArray(value.clusters)
  ) {
    return null;
  }

  const allowedRootKeys = new Set([
    'clusters',
    'uncertain',
    'toolAction',
    'toolSummary'
  ]);

  if (
    Object.keys(value).some(
      key => !allowedRootKeys.has(key)
    )
  ) {
    return null;
  }

  const canonicalClusters = [];

  for (const cluster of value.clusters) {
    if (
      !cluster ||
      typeof cluster !== 'object' ||
      Array.isArray(cluster) ||
      !Array.isArray(cluster.articleIds)
    ) {
      return null;
    }

    const allowedClusterKeys =
      new Set(['articleIds', 'confidence']);

    if (
      Object.keys(cluster).some(
        key => !allowedClusterKeys.has(key)
      )
    ) {
      return null;
    }

    // Confidence is advisory metadata. Two Antigravity roots that express the
    // same exact partition are semantically equivalent even when one root
    // includes confidence and the other omits it. Canonical identity therefore
    // depends only on membership plus the root-level uncertainty flag.
    canonicalClusters.push({
      articleIds:
        cluster.articleIds
          .map(String)
          .sort()
    });
  }

  canonicalClusters.sort(
    (left, right) =>
      JSON.stringify(left)
        .localeCompare(
          JSON.stringify(right)
        )
  );

  const decision = {
    clusters: value.clusters,
    uncertain: value.uncertain
  };

  return {
    decision,
    canonical:
      JSON.stringify({
        clusters: canonicalClusters,
        uncertain: value.uncertain
      }),
    metadataScore:
      value.clusters.filter(cluster =>
        typeof cluster?.confidence === 'number' &&
        Number.isFinite(cluster.confidence)
      ).length,
    strippedToolMetadata:
      Object.prototype.hasOwnProperty.call(
        value,
        'toolAction'
      ) ||
      Object.prototype.hasOwnProperty.call(
        value,
        'toolSummary'
      )
  };
}

function normalizeAntigravityClusteringOutput(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return text;

  const roots =
    extractCompleteJsonRoots(text);

  const normalized = [];

  for (const root of roots) {
    try {
      const candidate =
        normalizeAntigravityDecision(
          JSON.parse(root)
        );
      if (candidate) normalized.push(candidate);
    } catch {
      // Leave malformed roots to the existing generic JSON recovery path.
    }
  }

  if (!normalized.length) return text;

  const canonical =
    new Set(
      normalized.map(
        candidate => candidate.canonical
      )
    );

  if (canonical.size > 1) {
    const error = new Error(
      'Antigravity returned multiple conflicting JSON roots'
    );
    error.code = 'INVALID_JSON';
    error.reason =
      'multiple_conflicting_roots';
    error.rawResponse = text;
    throw error;
  }

  const strippedToolMetadata =
    normalized.some(
      candidate =>
        candidate.strippedToolMetadata
    );

  if (
    normalized.length > 1 ||
    strippedToolMetadata
  ) {
    console.info(
      '[SMART ANTIGRAVITY NORMALIZE]',
      JSON.stringify({
        roots: roots.length,
        usableRoots: normalized.length,
        deduplicated:
          normalized.length > 1,
        strippedToolMetadata
      })
    );
  }

  const preferred = normalized.reduce(
    (best, candidate) =>
      (candidate.metadataScore || 0) > (best.metadataScore || 0)
        ? candidate
        : best,
    normalized[0]
  );

  return JSON.stringify(
    preferred.decision
  );
}

function normalizeAntigravityComponentDecision(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !Array.isArray(value.exactEventGroups) ||
    !Array.isArray(value.relatedDevelopments)
  ) {
    return null;
  }

  const allowedRootKeys = new Set([
    'exactEventGroups',
    'relatedDevelopments',
    'uncertain',
    'toolAction',
    'toolSummary'
  ]);
  if (Object.keys(value).some(key => !allowedRootKeys.has(key))) return null;

  const canonicalGroups = value.exactEventGroups.map(group => ({
    componentIds: Array.isArray(group?.componentIds) ? [...group.componentIds].map(String).sort() : []
  })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));

  const canonicalRelations = value.relatedDevelopments.map(relation => ({
    componentIds: Array.isArray(relation?.componentIds) ? [...relation.componentIds].map(String).sort() : []
  })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));

  return {
    decision: {
      exactEventGroups: value.exactEventGroups,
      relatedDevelopments: value.relatedDevelopments,
      uncertain: value.uncertain
    },
    canonical: JSON.stringify({
      exactEventGroups: canonicalGroups,
      relatedDevelopments: canonicalRelations,
      uncertain: value.uncertain
    }),
    metadataScore:
      value.exactEventGroups.filter(group =>
        typeof group?.confidence === 'number' && Number.isFinite(group.confidence)
      ).length +
      value.relatedDevelopments.filter(relation =>
        typeof relation?.confidence === 'number' && Number.isFinite(relation.confidence)
      ).length,
    strippedToolMetadata:
      Object.prototype.hasOwnProperty.call(value, 'toolAction') ||
      Object.prototype.hasOwnProperty.call(value, 'toolSummary')
  };
}

function normalizeAntigravityComponentOutput(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return text;

  const roots = extractCompleteJsonRoots(text);
  const normalized = [];
  for (const root of roots) {
    try {
      const candidate = normalizeAntigravityComponentDecision(JSON.parse(root));
      if (candidate) normalized.push(candidate);
    } catch {
      // Generic JSON recovery/repair handles malformed content.
    }
  }
  if (!normalized.length) return text;

  const canonical = new Set(normalized.map(candidate => candidate.canonical));
  if (canonical.size > 1) {
    const error = new Error('Antigravity returned multiple conflicting component-review JSON roots');
    error.code = 'INVALID_JSON';
    error.reason = 'multiple_conflicting_roots';
    error.rawResponse = text;
    throw error;
  }

  console.log(
    '[SMART ANTIGRAVITY NORMALIZE]',
    JSON.stringify({
      operation: 'component-review',
      roots: roots.length,
      usableRoots: normalized.length,
      deduplicated: normalized.length > 1,
      strippedToolMetadata: normalized.some(candidate => candidate.strippedToolMetadata)
    })
  );

  const preferred = normalized.reduce(
    (best, candidate) =>
      (candidate.metadataScore || 0) > (best.metadataScore || 0)
        ? candidate
        : best,
    normalized[0]
  );

  return JSON.stringify(preferred.decision);
}

async function requestVerificationProvider(
  provider,
  group,
  keyManager,
  repairPrompt = null,
  reviewSpec = null
) {
  reviewSpec = extendAiReview(group, reviewSpec, buildVerificationPrompt(group.articles), PARTITION_RESPONSE_SCHEMA);
  const prompt =
    reviewSpec?.prompt ||
    buildVerificationPrompt(group.articles);
  const schema =
    reviewSpec?.schema ||
    PARTITION_RESPONSE_SCHEMA;
  const operation =
    reviewSpec?.operation ||
    'cluster-verification';

  const onRequest = () => {
    if (group.metrics) {
      group.metrics[repairPrompt ? 'jsonRepairCalls' : 'firstPassAiCalls']++;
      if (group.isFallback) group.metrics.fallbackProviderCalls++;
    }

    // Custom consumers such as editorial assessment keep separate metrics.
    reviewSpec?.onRequest?.();
  };

  if (provider.type === 'antigravity') {
    const result = await generateWithAntigravity(repairPrompt || prompt, {
      model: provider.model,
      timeoutMs: provider.timeoutMs,
      json: false,
      schema,
      operation,
      onRequest
    });
    return {
      text:
        reviewSpec?.componentReview
          ? normalizeWithSideTask(result.text, normalizeAntigravityComponentOutput)
          : reviewSpec?.editorialReview
            ? result.text
            : normalizeWithSideTask(result.text, normalizeAntigravityClusteringOutput),
      rawProviderText: result.text,
      onlineAiUsage: result.onlineAiUsage || null
    };
  }

  if (provider.type === 'gemini-web') {
    const result =
      await generateWithGeminiWeb(
        repairPrompt || prompt,
        {
          timeoutMs:
            provider.timeoutMs,
          json: true,
          schema,
          operation,
          onRequest
        }
      );

    return {
      text: result.text,
      rawProviderText:
        result.text,
      onlineAiUsage:
        result.onlineAiUsage ||
        result.usage ||
        null
    };
  }

  if (provider.type === 'gemini') {
    const keyObject = await acquireGeminiKey(keyManager, 1000);

    if (
      keyObject &&
      keyManager?.recordUsage
    ) {
      keyManager.recordUsage(keyObject);
    }

    return requestGeminiPartition(
      group.articles,
      keyObject?.key,
      provider.model,
      provider.timeoutMs,
      Number(keyObject?.index) + 1,
      {
        repairPrompt,
        prompt,
        schema,
        onRequest,
        rawOutput: true,
        maxOutputTokens:
          reviewSpec?.maxOutputTokens ||
          provider.maxOutputTokens,
        thinkingLevel:
          provider.thinkingLevel
      }
    );
  }

  if (provider.type === 'ollama') {
    const limit =
      reviewSpec?.componentReview
        ? providerReviewComponentLimit(provider)
        : providerReviewArticleLimit(provider);
    const size =
      reviewSpec?.componentReview
        ? (reviewSpec.units?.length || 0)
        : group.articles.length;

    if (Number.isFinite(limit) && size > limit) {
      const error = new Error(
        `Local review group is too large: ${size} > ${limit}`
      );
      error.code = 'GROUP_TOO_LARGE';
      error.nonProviderFault = true;
      throw error;
    }

    const localStartedAt =
      Date.now();

    try {
      const text =
        await requestLocalPartition(
          group.articles,
          provider.baseUrl,
          provider.model,
          provider.timeoutMs,
          repairPrompt,
          true,
          onRequest,
          {
            prompt,
            schema,
            operation,
            maxOutputTokens:
              reviewSpec?.maxOutputTokens
          }
        );

      console.log(
        '[ONLINE AI]',
        JSON.stringify({
          at:
            new Date().toISOString(),
          provider:
            'local-qwen',
          providerId:
            provider.id,
          operation,
          model:
            provider.model,
          status:
            'success',
          durationMs:
            Date.now() -
            localStartedAt
        })
      );

      return text;
    } catch (error) {
      console.log(
        '[ONLINE AI]',
        JSON.stringify({
          at:
            new Date().toISOString(),
          provider:
            'local-qwen',
          providerId:
            provider.id,
          operation,
          model:
            provider.model,
          status:
            'failed',
          durationMs:
            Date.now() -
            localStartedAt,
          errorCode:
            String(
              error?.code ||
              error?.name ||
              'LOCAL_QWEN_ERROR'
            ).slice(0, 80),
          error:
            String(
              error?.message ||
              error
            ).replace(/\s+/g, ' ').slice(0, 800)
        })
      );

      throw error;
    }
  }

  throw new Error(
    `Unsupported provider type: ${provider.type}`
  );
}

export { normalizeAntigravityClusteringOutput, callVerificationProvider };

function callVerificationProvider(...args) {
  return requestWithOptionalSideTask(requestVerificationProvider, ...args);
}
