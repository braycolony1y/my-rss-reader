import { authMiddleware } from '../middleware/auth.js';
import { geminiKeyManager } from '../../summary-engine.js';
import { parseOnlineAiUsageLog } from '../online-ai-usage.js';

export function registerAiRoutes({
    app,
    smartNews,
    env,
    readOnlineAiUsageWindow,
    validateGeminiKey,
    persistAndActivateGeminiKey,
} = {}) {
    app.get('/api/gemini-key-status', authMiddleware, async (req, res) => {
        const activeKey = geminiKeyManager.getCurrentKeyObj();
        const keyStats = geminiKeyManager.getDebugStats();
        const apiKey = activeKey?.key || '';
        const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
        const smartStatus = await smartNews.getStatus();
        const rawProviderHealth = await env.RSS_DATA.get('smartAiProviderHealth', { type: 'json' }).catch(()=>null);
        const providerHealth = rawProviderHealth || {};
        const smartError = String(smartStatus.geminiError || '');
        const smartHttpStatus = Number((smartError.match(/(?:Gemini|Local AI) HTTP\s+(\d{3})/i) || [])[1]) || null;
        const smartErrorSummary = smartHttpStatus === 429
            ? 'Gemini returned HTTP 429. The request pacer was used; the last successful snapshot is kept if online AI remains unavailable.'
            : smartError.split('\n')[0].slice(0, 240);
        const persistedKeyErrors = Array.isArray(smartStatus.geminiKeyErrors)
            ? smartStatus.geminiKeyErrors.map(event => ({
                key: Number(event.key) || 0,
                httpStatus: Number(event.httpStatus) || null,
                category: String(event.category || '').slice(0, 100),
                provider: 'Gemini',
                error: String(event.error || '').split('\n')[0].slice(0, 240),
                at: event.at || ''
            })).filter(event => event.key > 0)
            : [];
        const persistedLocalErrors = Array.isArray(smartStatus.localErrors)
            ? smartStatus.localErrors.map(event => ({
                key: 0,
                httpStatus: Number(event.httpStatus) || null,
                category: String(event.category || '').slice(0, 100),
                provider: 'Local AI',
                model: String(event.model || smartStatus.localModel || '').slice(0, 80),
                error: String(event.error || '').split('\n')[0].slice(0, 240),
                at: event.at || ''
            }))
            : [];
        const runtimeKeyErrors = (keyStats.keys || []).filter(key => key.lastError || key.lastHttpStatus).map(key => ({
            key: Number(key.index) + 1,
            httpStatus: Number(key.lastHttpStatus) || null,
            category: 'current key state',
            provider: 'Gemini',
            error: String(key.lastError || '').split('\n')[0].slice(0, 240),
            at: key.lastErrorAt || ''
        }));
        const persistedAiKeyErrors = [...persistedLocalErrors, ...persistedKeyErrors];
        const base = {
            configured: keyStats.totalKeys > 0,
            keyCount: keyStats.totalKeys,
            activeKey: keyStats.totalKeys ? keyStats.activeKeyIndex + 1 : 0,
            autoFailovers: keyStats.autoSwitchCount,
            model,
            checkedAt: new Date().toISOString(),
            usageUrl: 'https://aistudio.google.com/usage',
            exactRemainingAvailable: false,
            exactRemainingExplanation: 'Google exposes live RPM, TPM, RPD, tier, and remaining usage in the AI Studio project dashboard, not through a Gemini API key.',
            providerHealth,
            lastSmartRun: {
                state: smartStatus.state || '',
                startedAt: smartStatus.startedAt || '',
                completedAt: smartStatus.completedAt || '',
                localConfigured: Boolean(smartStatus.localConfigured),
                localUsed: Boolean(smartStatus.localUsed),
                localModel: smartStatus.localModel || process.env.OLLAMA_SMART_MODEL || 'qwen3.5:4b',
                geminiUsed: Boolean(smartStatus.geminiUsed),
                providers: Array.isArray(smartStatus.aiProviders) ? smartStatus.aiProviders : [],
                providerOrder: Array.isArray(smartStatus.providerOrder) ? smartStatus.providerOrder.filter(provider => provider !== 'qwen-flash') : ['gemini-flash-lite', 'gemini-flash', 'local-qwen'],
                progress: smartStatus.progress || null,
                reviewedArticleCount: smartStatus.verificationStats ? Number(smartStatus.verificationStats.reviewedArticleCount) : (Number(smartStatus.geminiReviewedArticleCount) || 0),
                eligibleArticleCount: Number(smartStatus.candidateCount) || Number(smartStatus.geminiEligibleArticleCount) || 0,
                reason: smartStatus.reason || smartStatus.geminiReason || '',
                error: smartErrorSummary,
                httpStatus: smartHttpStatus,
                keyErrors: persistedAiKeyErrors.length ? persistedAiKeyErrors : runtimeKeyErrors,
                byCategory: smartStatus.geminiByCategory || {},
                keptExistingClusters: Boolean(smartStatus.keptExistingClusters)
            }
        };
        if (!keyStats.totalKeys) return res.json({ ...base, valid: false, state: 'not_configured', httpStatus: null });
        if (!apiKey) return res.json({
            ...base,
            valid: true,
            state: 'all_keys_cooling_down',
            httpStatus: 429,
            error: 'HTTP 429 · All configured Gemini keys are currently rate limited and cooling down.'
        });

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        try {
            const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':countTokens', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': apiKey
                },
                body: JSON.stringify({ contents: [{ parts: [{ text: 'RSS Reader key check' }] }] }),
                signal: controller.signal
            });
            const payload = await response.json().catch(() => ({}));
            if (response.ok) {
                return res.json({ ...base, valid: true, state: 'ready', httpStatus: response.status, testedKey: (activeKey?.index || 0) + 1, validationTokens: Number(payload.totalTokens) || 0 });
            }
            const message = String(payload?.error?.message || ('Gemini returned HTTP ' + response.status)).slice(0, 240);
            if (response.status === 429) return res.json({ ...base, valid: true, state: 'quota_limited', httpStatus: response.status, testedKey: (activeKey?.index || 0) + 1, error: message });
            return res.json({ ...base, valid: false, state: response.status === 401 || response.status === 403 ? 'invalid_key' : 'error', httpStatus: response.status, testedKey: (activeKey?.index || 0) + 1, error: message });
        } catch (error) {
            return res.json({ ...base, valid: false, state: 'unreachable', httpStatus: null, testedKey: (activeKey?.index || 0) + 1, error: String(error.message || error).slice(0, 240) });
        } finally {
            clearTimeout(timeout);
        }
    });

    app.get('/api/online-ai-usage', authMiddleware, async (req, res) => {
        try {
            const limit = Math.max(1, Math.min(5000, Number(req.query.limit) || 500));
            const offset = Math.max(0, Number(req.query.offset) || 0);
            const { rawLog, source, warning } = await readOnlineAiUsageWindow();
            const report = parseOnlineAiUsageLog(rawLog, { limit, offset });
            res.setHeader('Cache-Control', 'no-store');
            res.json({ ...report, source, warning: warning || null });
        } catch (error) {
            res.status(503).json({
                error: 'Could not load the last 24 hours of online AI activity.',
                detail: String(error.message || error).slice(0, 300)
            });
        }
    });

    app.post('/api/gemini-keys', authMiddleware, async (req, res) => {
        const apiKey = String(req.body?.apiKey || '').trim();
        if (apiKey.length < 20 || apiKey.length > 512 || /\s/.test(apiKey)) {
            return res.status(400).json({ error: 'Enter a complete Gemini API key without spaces.' });
        }

        const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
        try {
            const validation = await validateGeminiKey(apiKey, model);
            const result = await persistAndActivateGeminiKey(apiKey);
            console.log(`[GEMINI KEY] ${result.added ? 'Added' : 'Reactivated'} key ${result.index + 1}; active immediately; ${result.keyCount} configured.`);
            return res.json({
                success: true,
                added: result.added,
                alreadyConfigured: result.alreadyConfigured,
                activeKey: result.index + 1,
                keyCount: result.keyCount,
                model,
                validationHttpStatus: validation.httpStatus,
                validationTokens: validation.validationTokens,
                message: result.added
                    ? `Key ${result.index + 1} was validated, saved privately, and activated immediately.`
                    : `Key ${result.index + 1} was already configured and is active now.`
            });
        } catch (error) {
            const httpStatus = Number(error.status) || null;
            const responseStatus = httpStatus === 401 || httpStatus === 403 ? 400 : 502;
            return res.status(responseStatus).json({
                error: httpStatus
                    ? `Gemini validation failed with HTTP ${httpStatus}.`
                    : 'Gemini validation could not be completed.',
                detail: String(error.message || error).slice(0, 300),
                httpStatus
            });
        }
    });

}
