import { bindPersonalState, personalPublishedExcluded } from '../feedback/pipeline.js';
import { personalEnabled } from '../feedback/terminal.js';
import { getPersonalStore } from '../feedback/store.js';
import { getPrefilterStore, terminalExcluded } from './state.js';
import { prefilterEnabled, SECTIONS } from './policy.js';

const views = new WeakMap();

// Published snapshots are immutable. Recheck after every committed personal
// change or system decision, but never retain an obsolete snapshot for reuse.
export async function filterPublishedView(db, snapshot) {
    if (!snapshot?.articles?.length) return snapshot;
    const personalOn = personalEnabled();
    const systemOn = prefilterEnabled() && snapshot.articles.some(article => SECTIONS.includes(article?.topStory?.feed));
    const personal = personalOn ? await getPersonalStore(db) : null;
    if (personalOn) await bindPersonalState(db);
    const system = systemOn ? await getPrefilterStore(db) : null;
    let cache = views.get(db);
    if (!cache) { cache = new WeakMap(); views.set(db, cache); }
    const previous = cache.get(snapshot);
    const state = personal?.state, revision = system?.revision;
    if (previous && previous.state === state && previous.revision === revision
        && previous.personalOn === personalOn && previous.systemOn === systemOn) return previous.result;
    const articles = [];
    for (const article of snapshot.articles) {
        const section = article?.topStory?.feed;
        if (personalOn && await personalPublishedExcluded(db, article, section)) continue;
        if (systemOn && SECTIONS.includes(section)
            && [article, ...(article.relatedArticles || [])].some(member => terminalExcluded(member, section))) continue;
        articles.push(article);
    }
    const result = articles.length === snapshot.articles.length ? snapshot : { ...snapshot, articles };
    // A filter pass can durably add personal decisions. Never cache across a
    // state change, including an undo arriving while the pass is in progress.
    if (personal?.state === state && system?.revision === revision)
        cache.set(snapshot, { state, revision, personalOn, systemOn, result });
    return result;
}
