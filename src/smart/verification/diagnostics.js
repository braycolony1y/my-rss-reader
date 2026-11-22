import { getGeminiWebCooldownState } from '../../ai/gemini-web.js';

function providerDeferredError(retryAt, reason = 'provider_cooldown') {
  const error =
    new Error(
      `${reason}; retry at ${
        new Date(retryAt).toISOString()
      }`
    );

  error.code =
    'AI_PROVIDER_DEFERRED';

  error.retryAt =
    retryAt;

  error.cooldownUntil =
    retryAt;

  error.nonProviderFault =
    true;

  return error;
}

function shortGeminiWebRetryAt() {
  const state =
    getGeminiWebCooldownState();

  return (
    state.enabled &&
    state.remainingMs > 0 &&
    state.remainingMs <= 60_000
  )
    ? state.retryAt
    : 0;
}

const RAW_PROVIDER_DIAGNOSTIC_LIMIT = Math.max(
  2_000,
  Math.min(
    100_000,
    Number(process.env.SMART_AI_RAW_LOG_MAX_CHARS) || 24_000
  )
);

function sanitizeProviderDiagnosticText(
  value,
  maximum = RAW_PROVIDER_DIAGNOSTIC_LIMIT
) {
  const original = String(value ?? '');
  const sanitized = original
    .replace(/([?&](?:key|api_key|apiKey)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]')
    .replace(/(?:Authorization\s*[:=]\s*)([^\r\n,}]+)/gi, 'Authorization: [REDACTED]')
    .replace(/x-goog-api-key\s*[:=]\s*[^\s,}]+/gi, 'x-goog-api-key: [REDACTED]')
    .replace(/AIza[A-Za-z0-9_-]{20,}/g, '[REDACTED_API_KEY]')
    .replace(/((?:\"|')?(?:api[_-]?key|cookie)(?:\"|')?\s*[:=]\s*(?:\"|'))[^\"'\r\n]+/gi, '$1[REDACTED]');

  const limit = Math.max(256, Number(maximum) || RAW_PROVIDER_DIAGNOSTIC_LIMIT);
  return {
    text: sanitized.slice(0, limit),
    originalLength: original.length,
    sanitizedLength: sanitized.length,
    truncated: sanitized.length > limit
  };
}

function providerJsonDiagnosticFields(diagnostics) {
  if (!diagnostics) return {};

  const originalRaw =
    diagnostics.originalRawResponse ??
    diagnostics.rawResponse ??
    '';
  const repairRaw =
    diagnostics.repairRawResponse ??
    '';
  const original = sanitizeProviderDiagnosticText(originalRaw);
  const repair = sanitizeProviderDiagnosticText(repairRaw);
  const repairSucceeded =
    diagnostics.repairSucceeded === true
      ? true
      : diagnostics.repairSucceeded === false
        ? false
        : null;

  return {
    parserReason:
      String(
        diagnostics.originalReason ??
        diagnostics.reason ??
        ''
      ).slice(0, 160) || null,
    rawResponse: original.text || null,
    rawResponseLength: original.originalLength || 0,
    rawResponseShownLength: original.text.length,
    rawResponseTruncated: original.truncated,
    repairAttempted: Boolean(diagnostics.repairAttempted),
    repairSucceeded,
    repairReason:
      String(diagnostics.repairReason ?? '').slice(0, 160) || null,
    repairRawResponse: repair.text || null,
    repairRawResponseLength: repair.originalLength || 0,
    repairRawResponseShownLength: repair.text.length,
    repairRawResponseTruncated: repair.truncated
  };
}

function sanitizeProviderErrorMessage(
  message
) {
  return String(
    message ||
    'Unknown provider error'
  )
    .replace(
      /([?&]key=)[^&\s]+/gi,
      '$1[REDACTED]'
    )
    .replace(
      /Bearer\s+[A-Za-z0-9._~-]+/gi,
      'Bearer [REDACTED]'
    )
    .replace(
      /x-goog-api-key\s*[:=]\s*[^\s,}]+/gi,
      'x-goog-api-key: [REDACTED]'
    )
    .split('\n')[0]
    .slice(0, 300);
}

function normalizeProviderError(error) {
  const status =
    Number(
      error?.status ||
      error?.httpStatus
    ) || null;

  return {
    code:
      error?.code ||
      (
        status
          ? `HTTP_${status}`
          : 'UNKNOWN_ERROR'
      ),

    httpStatus: status,

    message:
      sanitizeProviderErrorMessage(
        error?.message ||
        error
      )
  };
}

function isTransientProviderError(
  error
) {
  const status =
    Number(
      error?.status ||
      error?.httpStatus
    );

  return (
    error?.name === 'AbortError' ||
    error?.code === 'ETIMEDOUT' ||
    error?.code === 'ECONNRESET' ||
    error?.code === 'EAI_AGAIN' ||
    [429, 500, 502, 503, 504]
      .includes(status)
  );
}

function isModelOutputError(
  error
) {
  const code =
    String(error?.code || '')
      .toUpperCase();

  const message =
    String(error?.message || '')
      .toLowerCase();

  return (
    code === 'INVALID_JSON' ||
    code === 'INVALID_PARTITION' ||
    code === 'POST_VALIDATION_FAILED' ||
    code === 'LITE_ESCALATION_REQUIRED' ||
    code === 'ANTIGRAVITY_ESCALATION_REQUIRED' ||
    code === 'COMPONENT_REVIEW_UNCERTAIN' ||
    message.includes(
      'invalid json'
    ) ||
    message.includes(
      'invalid partition'
    ) ||
    message.includes(
      'empty response'
    ) ||
    message.includes(
      'empty content'
    ) ||
    message.includes(
      'post-validation'
    )
  );
}

export { providerDeferredError, sanitizeProviderDiagnosticText, providerJsonDiagnosticFields, sanitizeProviderErrorMessage, normalizeProviderError, isTransientProviderError, isModelOutputError };
