import { getLocalComputeState } from '../../ai/local-compute.js';
import { withinPickerBudget, PICKER_AI_BUDGET_MS } from './request-budget.js';
import { semantics as s } from './semantics.js';
import { getEnabledVerificationProviders } from '../verification/provider-config.js';
import { callVerificationProvider } from '../verification/providers.js';
import { parseClusteringJson } from '../../ai/clustering-json.js';
import { runGlobalAiTask } from '../../ai/global-ai-scheduler.js';

export function createInteractiveReasons(keyManager, { schedule = runGlobalAiTask, request = callVerificationProvider, providers = getEnabledVerificationProviders, localState = getLocalComputeState, timeoutMs = PICKER_AI_BUDGET_MS } = {}) {
    const cache = new Map();
    return async ({ article, rejected = [], input = '', signal }) => {
        const cacheKey = JSON.stringify([article.title, s.section(article), article.feedbackTraits, article.feedUrl, rejected, input]);
        if (cache.has(cacheKey)) return cache.get(cacheKey);
        const local = input ? s.interpret(input, article) : null;
        if (local) return { reasons: [local], interpretation: true };
        const pool = s.pool(article).filter(r => !s.isRejected(r.rule, rejected));
        if (!input && pool.length >= 4) return { reasons: pool.slice(0, 6) };
        // Never use browser/OpenCLI providers for picker backfill.
        const hasKey = !!keyManager?.getCurrentKeyObj?.()?.key;
        const available = () => providers(hasKey).find(p => p.type === 'gemini' ? !!keyManager?.getCurrentKeyObj?.()?.key : p.type === 'ollama' && !localState().active && !localState().pending?.length);
        const fallback = message => ({ reasons: input ? [] : pool.slice(0, 7), exhausted: true, retryable: true, message });
        const provider = available();
        if (!provider) return fallback('More suggestions are temporarily unavailable. Use Other to describe your reason, or try again.');
        const schema = { type: 'object', properties: { reasons: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, rule: { type: 'object', properties: Object.fromEntries(['dimension','scope','strength','entity','topic','eventType','storyAngle','source'].map(k => [k, { type: 'string' }])) } } } } } };
        const prompt = `The user is considering personal Smart feedback. Propose reasons only; DO NOT infer or save a preference. ${input ? 'Interpret ALL qualifiers in the user text precisely, preserving entity AND angle/type. Return one narrow interpretation for explicit review. If unclear return an empty list.' : 'Return 4–7 distinct plausible reasons from different supported semantic dimensions. Do NOT paraphrase any rejected semantic rule. If exhausted return an empty list, never invent evidence.'}
Rules: dimensions entity/topic/story_type/quality/materiality/source/repetition; strengths routine_only/narrow/topic/source/same_event/hide_all_entity. Use hide_all_entity ONLY for an explicit hide-all input. All constraints are conjunctive. Scope must be ${s.section(article)}. Main event types: ${s.types.map(([id]) => id).join(', ')}. Only supplied article text; no tools, browsing, fetch, embeddings, ranking or research.
${JSON.stringify({ article: { title: article.title, excerpt: article.description || article.summary, content: String(article.content || '').slice(0, 5000), feedbackTraits: article.feedbackTraits, source: article.feedTitle }, rejectedSemanticRules: rejected, userText: input })}`;
        let result;
        try {
            result = await withinPickerBudget(remaining => schedule({ lane: 'p1', background: false, label: 'smart-feedback:interactive' }, async () => {
                // Check AFTER scheduling: neither a cancelled picker nor a provider
                // that became busy should enqueue new work later.
                try {
                    const budget = remaining();
                    const ready = available();
                    if (!ready) return null;
                    return await request({ ...ready, timeoutMs: Math.min(ready.timeoutMs || budget, budget) }, { articles: [] }, keyManager, null, { prompt, schema, operation: 'smart-feedback-picker', editorialReview: true, maxOutputTokens: 1600 });
                } catch {
                    // In particular, do not leak AI_PROVIDER_DEFERRED back to the
                    // scheduler and let it requeue a user picker for minutes.
                    return null;
                }
            }), { timeoutMs, signal });
        } catch {
            return fallback('Finding more reasons took too long. Use Other to describe your reason, or try again.');
        }
        if (!result) return fallback('More suggestions are temporarily unavailable. Use Other to describe your reason, or try again.');
        let parsed;
        try { parsed = parseClusteringJson(result?.text || result); } catch { parsed = {}; }
        const reasons = (Array.isArray(parsed.reasons) ? parsed.reasons : []).filter(r => s.validRule(r?.rule) && r.rule.scope === s.section(article) && r.label && (r.rule.strength !== 'hide_all_entity' || /hide all|block all/i.test(input))).map(r => s.reason(s.text(r.label), r.rule)).filter(r => !s.isRejected(r.rule, rejected));
        const response = { reasons: [...new Map([...pool, ...reasons].map(r => [r.id, r])).values()].slice(0, input ? 1 : 7), interpretation: !!input, exhausted: !reasons.length };
        if (input) response.reasons = reasons.slice(0, 1);
        if (!reasons.length) return fallback('No further supported suggestions were found. Use Other to describe your reason, or try again.');
        cache.set(cacheKey, response);
        if (cache.size > 100) cache.delete(cache.keys().next().value);
        return response;
    };
}
