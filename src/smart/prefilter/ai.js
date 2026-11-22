import { personalEnabled } from '../feedback/terminal.js';
import { extendPersonalReview, splitPersonalOutput, acceptPersonalOutput, recoverPersonalTail } from '../feedback/ai.js';
import { parseClusteringJson } from '../../ai/clustering-json.js';
import { aiSideCandidates } from './boundaries.js';
import { acceptAiDecisions } from './state.js';
import { NEWS_RULES, TECH_RULES, prefilterEnabled } from './policy.js';

const rowSchema = { type: 'object', properties: {
  id: { type: 'string' }, section: { type: 'string', enum: ['news_vietnam', 'tech_vietnam'] },
  decision: { type: 'string', enum: ['keep', 'exclude'] }, confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  reasonCode: { type: 'string' }, reason: { type: 'string' },
  signals: { type: 'array', items: { type: 'string' } }, materialitySignals: { type: 'array', items: { type: 'string' } },
}, required: ['id', 'section', 'decision', 'confidence', 'reasonCode', 'reason', 'signals', 'materialitySignals'], additionalProperties: false };

export const SIDE_POLICY = [
  'SMART TOP EARLY-EXCLUSION SIDE TASK. Keep the primary task and all its IDs unchanged. Output all primary fields FIRST, then the optional smartTopPrefilter field LAST. Return at most four exclusion rows; omit KEEP rows. Never sacrifice the primary response for this side task.',
  'For each side candidate below, optionally return smartTopPrefilter rows at the JSON root. This is candidate-local exclusion, NOT ranking, Top-N, diversity, topic saturation or comparison.',
  'EXCLUDE only with HIGH confidence that the entire substantive event is a defined low-value class AND no public-interest/materiality override exists. Ambiguity, incomplete evidence, correction, denial, changed status or a substantive new development means KEEP. KEEP does not mean final inclusion.',
  'news_vietnam: BROAD public interest. Preserve governance, law/courts, health, education, society, local government, diplomacy, security, environment, weather/disasters, public safety, infrastructure, science and consequential statistics. Never require factories, money or corporate actions. Only pure vanity ranking, generic aspiration/speech, routine ceremony with no substantive consequence may be excluded.',
  `News reason codes: ${NEWS_RULES.map(([code]) => code).join(', ')}.`,
  'tech_vietnam: deliberately HIGH significance; zero stories is acceptable. Exclude ordinary ranking/index movement, adoption surveys, generic targets, conference/exhibition-only stories, awards/contests, non-binding MoUs, minor pilots/demos, minor training/research, corporate AI PR, and minor local digitization.',
  `Tech reason codes: ${TECH_RULES.map(([code]) => code).join(', ')}.`,
  'Tech overrides: plausible semiconductor/AI/industrial capability, material funded investment/JV/acquisition, factory/fab, major data center/cloud region/telecom, critical infrastructure, national lab/R&D, actual technology transfer, binding regulation/procurement, cybersecurity incident/widespread outage, important access or supply-chain change, substantial commercialization or measured economic/operational consequence. Research into domestic 500 kV capability survives. Conference + funded factory survives. Do not reject by a keyword alone.',
  'Ordinary product/app/feature updates, opinion or potential without a concrete event, and routine sports are allowed. Never exclude a candidate merely for belonging to one of these classes.',
  'Do not infer low value from the publisher. Do not change category. Do not propagate a Tech exclusion into News. A similar excluded title is not evidence without exact identity and no substantive change.',
  'Match each side-candidate title to the primary task evidence already supplied; absent context means KEEP. Use only the supplied evidence. No tools, browsing, retrieval or additional requests for this side task. If uncertain return keep; reasonCode may be empty for keep.',
].join('\n');

export function reviewArticles(group) {
  const roots = group.fullRepartition && group.reviewUniverse?.length ? group.reviewUniverse : group.articles || [];
  return [...new Map(roots.flatMap(article => [article, ...(article.relatedArticles || [])]).map(article => [article.smartTopPrefilterKey || article.link, article])).values()];
}
export function extendAiReview(group, spec, basePrompt, baseSchema) {
  if (personalEnabled()) spec = extendPersonalReview(reviewArticles(group), { ...spec, prompt: spec?.prompt || basePrompt, schema: spec?.schema || baseSchema });
  const candidates = aiSideCandidates(reviewArticles(group));
  if (!candidates.length) return spec;
  const primary = spec?.prompt || basePrompt;
  const side = `\n\n${SIDE_POLICY}\n${JSON.stringify({ smartTopPrefilterCandidates: candidates })}\n`;
  const payloadAt = primary.lastIndexOf('\n{');
  const prompt = payloadAt >= 0 ? primary.slice(0, payloadAt) + side + primary.slice(payloadAt) : primary + side;
  return { ...spec, prompt,
    // Optional field: malformed/missing side output must NEVER trigger a repair.
    schema: { ...(spec?.schema || baseSchema), properties: { ...(spec?.schema || baseSchema).properties,
      smartTopPrefilter: { type: 'array', items: rowSchema } } },
  };
}
// Existing provider normalizers are deliberately strict about primary root
// keys. Remove the optional side field before them, then restore it only if
// one unambiguous JSON object was parsed. Primary normalization stays intact.
export function normalizeWithSideTask(raw, normalizePrimary) {
  raw = recoverPrimaryBeforeSideTail(raw);
  let value;
  try { value = parseClusteringJson(raw); } catch { return normalizePrimary(raw); }
  if (!value || (!Object.hasOwn(value, 'smartTopPrefilter') && !Object.hasOwn(value, 'personalSmartFeedback'))) return normalizePrimary(raw);
  const { smartTopPrefilter, personalSmartFeedback, ...primary } = value;
  const normalized = normalizePrimary(JSON.stringify(primary));
  try { return JSON.stringify({ ...parseClusteringJson(normalized), smartTopPrefilter, personalSmartFeedback }); }
  catch { return normalized; }
}
export async function acceptAiSideTask(db, group, raw, stage) {
  let parsed;
  try { parsed = typeof raw === 'string' || raw?.text ? parseClusteringJson(raw?.text || raw) : raw; }
  catch { parsed = {}; }
  const articles = reviewArticles(group);
  const candidates = aiSideCandidates(articles);
  const rows = Array.isArray(parsed?.smartTopPrefilter) ? parsed.smartTopPrefilter : [];
  // One opportunity per revision. Missing/malformed rows fail open, without
  // asking a second AI or retrying the primary call for a side-task defect.
  const safeRows = candidates.map(candidate => {
    const matches = rows.filter(row => row?.id === candidate.id && row.section === candidate.section);
    return matches.length === 1 ? matches[0] : { ...candidate, decision: 'keep', confidence: 'low' };
  });
  await acceptAiDecisions(db, articles, safeRows, stage);
  await acceptPersonalOutput(db, articles, parsed, stage);
}
export function primaryDecision(value) {
  value = splitPersonalOutput(value).primary;
  if (!value || typeof value !== 'object' || !Object.hasOwn(value, 'smartTopPrefilter')) return value;
  const { smartTopPrefilter, ...primary } = value;
  return primary;
}

// If a model spends its last tokens on the OPTIONAL trailing field, retain a
// complete primary JSON object instead of scheduling a repair just for filtering.
export function recoverPrimaryBeforeSideTail(text) {
  const raw = recoverPersonalTail(text);
  try { parseClusteringJson(raw); return raw; } catch {}
  const match = /,\s*"smartTopPrefilter"\s*:/.exec(raw);
  if (!match) return raw;
  const prefix = raw.slice(0, match.index).replace(/^\s*```(?:json)?\s*/, '');
  try { const primary = JSON.parse(`${prefix}}`); return JSON.stringify(primary); }
  catch { return raw; }
}
export async function requestWithOptionalSideTask(request, ...args) {
  const result = await request(...args); // exactly the already-required request
  if (typeof result === 'string') return recoverPrimaryBeforeSideTail(result);
  if (result?.text) return { ...result, text: recoverPrimaryBeforeSideTail(result.text) };
  return result;
}
