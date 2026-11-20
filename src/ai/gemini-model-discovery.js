// Gemini API model discovery and overload/removal classification.
// Network access is injected so everything here is unit-testable.

const MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 5 * 60 * 1000;

// Single readable line from a Gemini API error body, e.g.
// "This model is currently experiencing high demand. ... (503 UNAVAILABLE)".
export function parseGeminiApiError(httpStatus, body) {
    let error = null;
    try {
        const parsed = JSON.parse(String(body || ''));
        error = parsed?.error || null;
    } catch { /* not JSON */ }
    const code = Number(error?.code) || Number(httpStatus) || null;
    const status = String(error?.status || '').trim() || null;
    const message = String(error?.message || String(body || '')).replace(/\s+/g, ' ').trim();
    const suffix = [code, status].filter(Boolean).join(' ');
    return {
        code, status, message,
        text: (message || `Gemini returned HTTP ${httpStatus}`) + (suffix ? ` (${suffix})` : '')
    };
}

export function classifyGeminiError(httpStatus, body) {
    const { status, message } = parseGeminiApiError(httpStatus, body);
    if (Number(httpStatus) === 404 || status === 'NOT_FOUND' ||
        /not found|is not supported for generatecontent|no longer available|deprecated/i.test(message)) {
        return 'model-not-found';
    }
    if (Number(httpStatus) === 503 || status === 'UNAVAILABLE' ||
        /high demand|overloaded|currently unavailable/i.test(message)) {
        return 'overloaded';
    }
    if (Number(httpStatus) === 429 || status === 'RESOURCE_EXHAUSTED') return 'quota';
    if ([500, 502, 504].includes(Number(httpStatus)) || status === 'INTERNAL' || status === 'DEADLINE_EXCEEDED') {
        return 'server-error';
    }
    return null;
}

// "3.10" is newer than "3.8": compare dotted parts numerically.
function compareVersions(a, b) {
    const left = a.split('.').map(Number), right = b.split('.').map(Number);
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
        const diff = (left[i] || 0) - (right[i] || 0);
        if (diff) return diff;
    }
    return 0;
}

// Price/performance order: newest stable non-lite Flash first, then older
// stable Flash models, then gemini-flash-latest, then the newest stable
// Flash-Lite as a last resort. Preview, tts, image, dated, live, omni,
// robotics, computer-use, deep-research, antigravity, gemma and other
// suffixed or experimental names never match the strict patterns.
export function rankFlashModels(models = []) {
    const ids = models
        .filter(model => !model.supportedGenerationMethods ||
            model.supportedGenerationMethods.includes('generateContent'))
        .map(model => String(model.name || '').replace(/^models\//, ''));
    const newest = pattern => ids
        .map(id => ({ id, match: id.match(pattern) }))
        .filter(item => item.match)
        .sort((x, y) => compareVersions(y.match[1], x.match[1]))
        .map(item => item.id);
    return [
        ...newest(/^gemini-(\d+(?:\.\d+)?)-flash$/),
        ...ids.filter(id => id === 'gemini-flash-latest'),
        ...newest(/^gemini-(\d+(?:\.\d+)?)-flash-lite$/)
    ];
}

export function createGeminiModelDiscovery({
    fetchImpl = (...args) => fetch(...args), now = Date.now, ttlMs = DEFAULT_TTL_MS
} = {}) {
    const cache = new Map();
    return {
        // Cached per API key; the key is only ever sent as a header.
        async candidates(apiKey) {
            if (!apiKey) return [];
            const cached = cache.get(apiKey);
            if (cached && cached.expiresAt > now()) return cached.ids;
            let response;
            try {
                response = await fetchImpl(MODELS_URL + '?pageSize=200', {
                    headers: { 'x-goog-api-key': apiKey },
                    signal: AbortSignal.timeout(8000)
                });
            } catch { response = null; }
            if (!response?.ok) {
                // Negative cache so an outage does not add a request per job.
                const ids = cached?.ids || [];
                cache.set(apiKey, { ids, expiresAt: now() + FAILURE_TTL_MS });
                return ids;
            }
            const payload = await response.json();
            const ids = rankFlashModels(payload.models || []);
            cache.set(apiKey, { ids, expiresAt: now() + ttlMs });
            return ids;
        }
    };
}

// Which replacement models to try after `failedModel` failed with `kind`.
export function replacementModels(candidates, failedModel, kind, limit = 2) {
    const others = candidates.filter(id => id !== failedModel);
    return kind ? others.slice(0, limit) : [];
}

// If the model is gone (404) or overloaded (503 high demand), try the next
// best discovered flash model instead of hammering the same one (bounded).
// `autoSelect`: no explicit model override, so use the best discovered
// model (cached); fall back to `model` when discovery yields nothing.
export async function generateWithModelDiscovery({
    model, prompt, options = {}, generate, discovery, currentKey, log = console.log, autoSelect = false
}) {
    let discovered = null;
    const discover = async () => {
        if (discovered) return discovered;
        try { discovered = await discovery.candidates(currentKey()); } catch { discovered = []; }
        return discovered;
    };
    if (autoSelect) {
        const [best] = await discover();
        if (best) model = best;
    }
    try {
        const result = await generate(model, prompt, options);
        result.modelUsed = model;
        return result;
    } catch (error) {
        if (!error?.geminiKind) throw error;
        const candidates = replacementModels(await discover(), model, error.geminiKind);
        for (const replacement of candidates) {
            log(`[SUMMARY] ${model} ${error.geminiKind}; trying ${replacement}`);
            try {
                const result = await generate(replacement, prompt, {
                    ...options,
                    timeoutMs: Math.min(options.timeoutMs || 25000, 25000),
                    requestedModel: model
                });
                result.modelUsed = replacement;
                result.requestedModel = model;
                result.modelFallback = true;
                return result;
            } catch (fallbackError) {
                if (!fallbackError?.geminiKind) throw fallbackError;
            }
        }
        throw error;
    }
}
