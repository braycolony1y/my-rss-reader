import { antigravityAvailable } from '../../ai/antigravity.js';
import { geminiWebConfigured } from '../../ai/gemini-web.js';
import { SMART_NEWS_AI_CONFIG, SMART_NEWS_CLUSTER_CONFIG } from '../config.js';

function providerEnabled(
  provider,
  hasGeminiKey
) {
  if (provider?.enabled === false) {
    return false;
  }

  const onlyLocal =
    process.env.SMART_ONLY_LOCAL ===
    'true';

  const geminiEnabled =
    process.env.USE_GEMINI !==
    'false' &&
    !onlyLocal;

  const localEnabled =
    process.env
      .SMART_LOCAL_AI_ENABLED !==
    'false';

  if (provider.type === 'antigravity') return !onlyLocal && antigravityAvailable();

  if (provider.type === 'gemini-web') {
    return (
      !onlyLocal &&
      geminiWebConfigured()
    );
  }

  if (
    provider.type === 'gemini'
  ) {
    return (
      geminiEnabled &&
      hasGeminiKey
    );
  }

  if (
    provider.type === 'ollama'
  ) {
    return localEnabled;
  }

  return false;
}

let preferredClusteringModel = null;

function setClusteringModel(model) {
  preferredClusteringModel = model;
}

function getEnabledVerificationProviders(
  hasGeminiKey
) {
  const providers = SMART_NEWS_AI_CONFIG
    .providers
    .filter(provider =>
      providerEnabled(
        provider,
        hasGeminiKey
      )
    )
    .sort(
      (left, right) =>
        left.priority -
        right.priority
    );

  if (preferredClusteringModel) {
    const preferredIdx = providers.findIndex(p =>
      p.type === 'gemini' &&
      (p.model === preferredClusteringModel || p.id === preferredClusteringModel)
    );
    if (preferredIdx >= 0) {
      const preferred = providers.splice(preferredIdx, 1)[0];
      const firstApiIndex = providers.findIndex(p => p.type !== 'antigravity');
      providers.splice(firstApiIndex >= 0 ? firstApiIndex : providers.length, 0, preferred);
    }
  }

  return providers;
}

function providerReviewArticleLimit(provider) {
  if (provider?.type === 'ollama') {
    return SMART_NEWS_CLUSTER_CONFIG
      .heavyAI
      .maxArticlesPerLocalReview;
  }

  if (
    provider?.type === 'antigravity' ||
    provider?.type === 'gemini-web' ||
    provider?.type === 'gemini'
  ) {
    return SMART_NEWS_CLUSTER_CONFIG
      .heavyAI
      .maxArticlesPerOnlineReview;
  }

  return Infinity;
}

function providerReviewComponentLimit(provider) {
  if (provider?.type === 'ollama') {
    return SMART_NEWS_CLUSTER_CONFIG
      .heavyAI
      .maxComponentsPerLocalReview;
  }

  if (
    provider?.type === 'antigravity' ||
    provider?.type === 'gemini-web' ||
    provider?.type === 'gemini'
  ) {
    return SMART_NEWS_CLUSTER_CONFIG
      .heavyAI
      .maxComponentsPerOnlineReview;
  }

  return Infinity;
}

export { providerEnabled, setClusteringModel, getEnabledVerificationProviders, providerReviewArticleLimit, providerReviewComponentLimit };
