import { preparePersonalCandidates, filterPersonalView, personalPublishedExcluded, bindPersonalState } from '../feedback/pipeline.js';
import { PERSONAL_STATE_KEY, getPersonalStore, personalSignature } from '../feedback/store.js';
import { createHash } from 'node:crypto';
import { FILTER_STATE_KEY, FILTER_VERSION, SECTIONS, prefilterEnabled } from './policy.js';
import { getPrefilterStore, terminalExcluded } from './state.js';
import { FILTER_POLICY_REVISION } from './retired-reasons.js';
import { hydrateStoredClusters, survivingClusters } from './boundaries.js';
import { buildCluster } from '../clustering/cluster.js';
import { filterPublishedView } from './published-view.js';

export async function prepareRankingCandidates(db, clusters, sources) {
  clusters = await preparePersonalCandidates(db, clusters, sources, 'pre_ranking');
  if (!prefilterEnabled()) return clusters;
  await getPrefilterStore(db);
  return survivingClusters(await hydrateStoredClusters(db, clusters, sources), buildCluster);
}
export async function prefilterWorkerState(db) {
  const personal = (await getPersonalStore(db)).state;
  const signature = await personalSignature(db);
  if (!prefilterEnabled()) return { signature: [signature], state: JSON.stringify({ personal }) };
  const store = await getPrefilterStore(db);
  const records = [...store.records.values()].filter(record => Object.values(record.decisions).some(d => d.status === 'exclude' && d.final));
  const state = JSON.stringify({ filterVersion: FILTER_VERSION, policyRevision: FILTER_POLICY_REVISION, records, personal });
  return { state, signature: [createHash('sha256').update(state).digest('hex')] };
}
export function workerPrefilterValues(serialized) {
  if (!serialized) return {};
  try { const data = JSON.parse(serialized); return { [FILTER_STATE_KEY]: data, [PERSONAL_STATE_KEY]: data.personal }; } catch { return {}; }
}
// A cached mixed card may contain a now-excluded source. Withhold that stale
// card until the normal ranker rebuilds it from surviving members. Never run
// an old briefing against the excluded evidence in the meantime.
export async function excludedPublishedStory(db, article, section = article?.topStory?.feed) {
  if (await personalPublishedExcluded(db, article, section)) return true;
  if (!prefilterEnabled() || !SECTIONS.includes(section)) return false;
  await getPrefilterStore(db);
  return [article, ...(article?.relatedArticles || [])].some(member => terminalExcluded(member, section));
}
export async function filterPublishedSnapshot(db, snapshot) {
  return filterPublishedView(db, snapshot);
}
export const excludedBriefingState = () => ({status:'source-only',generationState:'not-applicable',analysisStatus:'not-applicable',sections:[],keyFacts:[],sources:[],reason:'terminal_smart_top_exclusion'});
