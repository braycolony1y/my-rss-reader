import { personalSourceWork } from '../feedback/pipeline.js';
import { rawAllowedDestinations } from '../../articles/top-story-destinations.js';
import { getPrefilterStore, evaluateCandidate, fullyExcluded } from './state.js';
import { prefilterEnabled } from './policy.js';

// The source arrays retain every RSS item. Only Smart-specific resolution and
// speculative body warming receive this filtered view; ordinary reads still work.
export async function sourceWorkView(db, results, sources, metrics = {}) {
  results = await personalSourceWork(db, results, sources);
  if (!prefilterEnabled()) return results;
  const store = await getPrefilterStore(db, metrics);
  const view = results.map(result => ({ ...result, articles: (result.articles || []).filter(article => {
    evaluateCandidate(store, article, rawAllowedDestinations(article, sources), undefined, 'pre_source_resolution');
    return !fullyExcluded(article);
  }) }));
  await store.persist();
  return view;
}
