import { authMiddleware } from '../../middleware/auth.js';
import { confirmFeedback, undoFeedback, disableRule, getPersonalStore, identity } from './store.js';
import { bindPersonalState } from './pipeline.js';
import { createInteractiveReasons } from './interactive.js';
import { filterLog } from './log.js';
import { semantics as s } from './semantics.js';

export async function resolveFeedbackArticle(db, reference) {
    if (!reference?.link) throw new Error('A Smart article is required.');
    // Use only existing snapshots. Never acquire or reprocess content for this action.
    for (const key of ['topStoriesPublished', 'smartClusters', 'smartRawArticles']) {
        let snapshot = await db.get(key, { type: 'json', shared: true });
        if (typeof snapshot === 'string') { try { snapshot = JSON.parse(snapshot); } catch { continue; } }
        const rows = Array.isArray(snapshot) ? snapshot : snapshot?.articles || [];
        const found = rows.find(a => a.link === reference.link && (!reference.clusterId || !a.clusterId || a.clusterId === reference.clusterId));
        if (found) {
            const article = { ...found, feedbackSection: reference.feedbackSection || found.topStory?.feed || found.smartCategory };
            // A client's section must remain within the article's existing category family.
            const requested = String(article.feedbackSection || '');
            const category = String(found.topStory?.feed || found.smartCategory || '');
            if (category && requested && requested.split('_')[0] !== category.split('_')[0]) throw new Error('Invalid Smart section.');
            const state = (await getPersonalStore(db)).state;
            article.feedbackTraits ||= state.traits[identity(found).key];
            return article;
        }
    }
    throw new Error('This Smart article is no longer available. Refresh the feed and try again.');
}
export function registerPersonalFilterRoutes({ app, db, keyManager }) {
    const suggest = createInteractiveReasons(keyManager);
    const endpoint = handler => async (req, res) => {
        try { const result = await handler(req, res); if (!res.destroyed) res.json(result); } catch (error) { if (!res.destroyed) res.status(400).json({ error: error.message }); }
    };
    app.post('/api/smart-feedback/suggestions', authMiddleware, endpoint(async (req, res) => {
        const article = await resolveFeedbackArticle(db, req.body?.article);
        const rejected = Array.isArray(req.body.rejected) ? req.body.rejected.filter(x => typeof x === 'string').slice(-1000) : [];
        const controller = new AbortController();
        const cancel = () => controller.abort();
        res.once('close', cancel);
        try { return await suggest({ article, rejected, input: String(req.body.input || '').slice(0, 1000), signal: controller.signal }); }
        finally { res.off('close', cancel); }
    }));
    app.post('/api/smart-feedback/apply', authMiddleware, endpoint(async req => {
        if (req.body?.confirmed !== true) throw new Error('Explicit Apply confirmation is required.');
        const article = await resolveFeedbackArticle(db, req.body.article);
        const event = await confirmFeedback(db, { article, surface: req.body.surface, selectedReasons: req.body.selectedReasons, requestId: String(req.body.requestId || '').slice(0, 100) });
        await bindPersonalState(db);
        return { ok: true, event };
    }));
    app.post('/api/smart-feedback/undo', authMiddleware, endpoint(async req => {
        const result = await undoFeedback(db, req.body?.eventId);
        await bindPersonalState(db);
        return result;
    }));
    app.get('/api/smart-feedback/log', authMiddleware, endpoint(req => filterLog(db, { origin: req.query.origin, search: String(req.query.search || '').slice(0, 200), offset: Math.max(0, Number(req.query.offset) || 0), limit: 100 })));
    app.patch('/api/smart-feedback/rules/:id', authMiddleware, endpoint(async req => {
        const result = await disableRule(db, req.params.id, req.body?.remove === true);
        await bindPersonalState(db);
        return result;
    }));
}
