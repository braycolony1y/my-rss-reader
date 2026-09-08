import { authMiddleware } from '../middleware/auth.js';
import { setClusteringModel } from '../../smart-news.js';
import { normalizeStateUrl } from '../utils/article-utils.js';

export function registerSettingsRoutes({
    app,
    boardCache,
    env,
    normalizeClusteringModel,
    VALID_CLUSTERING_MODELS,
} = {}) {
    app.get('/api/user-states', authMiddleware, async (req, res) => {
        try {
            const prefs = await env.RSS_DATA.get('userPreferences', { type: 'json' }) || {};
            res.json({
                readStates: prefs.readStates || [],
                savedStates: prefs.savedStates || [],
                boardStates: prefs.boardStates || [],
                hiddenStates: prefs.hiddenStates || [],
                clusteringModel: normalizeClusteringModel(prefs.clusteringModel)
            });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/user-preferences', authMiddleware, async (req, res) => {
        try {
            const { key, value } = req.body;
            if (!key) return res.status(400).json({ error: 'Missing key' });
            if (key === 'clusteringModel') {
                if (!VALID_CLUSTERING_MODELS.has(value)) {
                    return res.status(400).json({ error: 'Unsupported clustering model' });
                }
            }

            await boardCache.updatePreference(key, value);
            if (key === 'clusteringModel') setClusteringModel(value);
            if (key === 'boardFolderMappings') {
                await boardCache?.reconcileMembership();
                void boardCache?.tick().catch(error => console.warn('[CACHE MEMBERSHIP]', error.message));
            }

            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/toggle', authMiddleware, async (req, res) => {
        const { link, list, forceAdd, forceRemove } = req.body;
        if (!['readStates', 'savedStates', 'boardStates', 'hiddenStates'].includes(list)) return res.status(400).send('Invalid List');

        let stateArray = await env.RSS_DATA.get(list, { type: 'json' }) || [];
        const normLink = normalizeStateUrl(link);

        if (forceRemove) {
            stateArray = stateArray.filter(item => normalizeStateUrl(item) !== normLink);
        } else if (forceAdd) {
            stateArray = stateArray.filter(item => normalizeStateUrl(item) !== normLink);
            stateArray.push(normLink);
        } else {
            if (stateArray.some(item => normalizeStateUrl(item) === normLink)) {
                stateArray = stateArray.filter(item => normalizeStateUrl(item) !== normLink);
            } else {
                stateArray.push(normLink);
            }
        }
        if (stateArray.length > 2000) stateArray.shift();
        await env.RSS_DATA.put(list, JSON.stringify(stateArray));

        if (list === 'readStates' && forceAdd) {
            for (const bumpList of ['savedStates', 'boardStates']) {
                let bArray = await env.RSS_DATA.get(bumpList, { type: 'json' }) || [];
                if (bArray.includes(link)) {
                    bArray = bArray.filter(l => l !== link);
                    bArray.push(link);
                    await env.RSS_DATA.put(bumpList, JSON.stringify(bArray));
                }
            }
        }

        if (list === 'boardStates') await boardCache?.reconcileMembership();
        res.status(200).send('Toggled');
    });

    app.post('/api/toggle-batch', authMiddleware, async (req, res) => {
        const { links, list, forceAdd, forceRemove } = req.body;
        if (!['readStates', 'savedStates', 'boardStates', 'hiddenStates'].includes(list)) return res.status(400).send('Invalid List');
        if (!Array.isArray(links)) return res.status(400).send('links must be an array');

        let stateArray = await env.RSS_DATA.get(list, { type: 'json' }) || [];
        let stateSet = new Set(stateArray);

        if (forceRemove) {
            links.forEach(link => stateSet.delete(link));
        } else if (forceAdd) {
            links.forEach(link => stateSet.add(link));
        }

        stateArray = Array.from(stateSet);
        while (stateArray.length > 2000) stateArray.shift();

        await env.RSS_DATA.put(list, JSON.stringify(stateArray));

        if (list === 'readStates' && forceAdd) {
            const linkSet = new Set(links);
            for (const bumpList of ['savedStates', 'boardStates']) {
                let bArray = await env.RSS_DATA.get(bumpList, { type: 'json' }) || [];
                const commonLinks = bArray.filter(l => linkSet.has(l));
                if (commonLinks.length > 0) {
                    bArray = bArray.filter(l => !linkSet.has(l));
                    bArray.push(...commonLinks);
                    await env.RSS_DATA.put(bumpList, JSON.stringify(bArray));
                }
            }
        }

        if (list === 'boardStates') await boardCache?.reconcileMembership();
        res.status(200).send('Toggled Batch');
    });

}
