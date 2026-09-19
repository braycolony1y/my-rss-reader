import { authMiddleware } from '../middleware/auth.js';
import { setClusteringModel } from '../../smart-news.js';
import { normalizeStateUrl } from '../utils/article-utils.js';
import { publishAppEvent } from '../events.js';

export function registerSettingsRoutes({
    app,
    boardCache,
    env,
    normalizeClusteringModel,
    VALID_CLUSTERING_MODELS,
} = {}) {
    let stateWrites = Promise.resolve();
    const serializeStateWrite = handler => (req, res) => {
        const operation = stateWrites.then(() => handler(req, res));
        stateWrites = operation.catch(() => {});
        return operation;
    };

    app.get('/api/user-states', authMiddleware, async (req, res) => {
        try {
            const prefs = await env.RSS_DATA.get('userPreferences', { type: 'json' }) || {};
            res.setHeader('Cache-Control', 'no-store');
            res.json({
                readStates: await env.RSS_DATA.get('readStates', { type: 'json' }) || [],
                savedStates: await env.RSS_DATA.get('savedStates', { type: 'json' }) || [],
                boardStates: await env.RSS_DATA.get('boardStates', { type: 'json' }) || [],
                hiddenStates: await env.RSS_DATA.get('hiddenStates', { type: 'json' }) || [],
                userPreferences: prefs,
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
            if (key === 'smartTabModes') {
                const tabs = new Set(['news', 'finance', 'news_vietnam', 'news_world', 'finance_vietnam', 'finance_global', 'tech']);
                if (!value || typeof value !== 'object' || Array.isArray(value) || Object.entries(value).some(([tab, mode]) => !tabs.has(tab) || !['top', 'classic'].includes(mode))) {
                    return res.status(400).json({ error: 'Choose Top stories or Classic for an existing Smart tab.' });
                }
            }
            if (key === 'topStoryCounts') {
                const tabs = new Set(['news', 'finance', 'news_vietnam', 'news_world', 'finance_vietnam', 'finance_global', 'tech']);
                if (!value || typeof value !== 'object' || Array.isArray(value) || Object.entries(value).some(([tab, count]) => !tabs.has(tab) || !Number.isInteger(count) || count < 0 || count > 20)) {
                    return res.status(400).json({ error: 'Top story counts must be integers from 0 to 20 for an existing Smart tab.' });
                }
            }
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

            publishAppEvent(
                'user-state-changed',
                {
                    kind: 'preference',
                    key,
                    value
                }
            );

            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/toggle', authMiddleware, serializeStateWrite(async (req, res) => {
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

        if (list === 'boardStates' || list === 'savedStates') await boardCache?.reconcileMembership();
        publishAppEvent(
            'user-state-changed',
            {
                kind: 'toggle',
                list,
                changes: [
                    {
                        link: normLink,
                        present: stateArray.some(
                            item =>
                                normalizeStateUrl(item) ===
                                normLink
                        )
                    }
                ]
            }
        );

        res.status(200).send('Toggled');
    }));

    app.post('/api/toggle-batch', authMiddleware, serializeStateWrite(async (req, res) => {
        const { links, list, forceAdd, forceRemove } = req.body;
        if (!['readStates', 'savedStates', 'boardStates', 'hiddenStates'].includes(list)) return res.status(400).send('Invalid List');
        if (!Array.isArray(links)) return res.status(400).send('links must be an array');

        let stateArray = await env.RSS_DATA.get(list, { type: 'json' }) || [];
        let stateSet = new Set(stateArray.map(normalizeStateUrl));

        if (forceRemove) {
            links.forEach(link => stateSet.delete(normalizeStateUrl(link)));
        } else if (forceAdd) {
            links.forEach(link => stateSet.add(normalizeStateUrl(link)));
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

        if (list === 'boardStates' || list === 'savedStates') await boardCache?.reconcileMembership();
        publishAppEvent(
            'user-state-changed',
            {
                kind: 'toggle-batch',
                list,
                changes: links.map(
                    link => {
                        const normalized =
                            normalizeStateUrl(link);

                        return {
                            link: normalized,
                            present:
                                stateSet.has(
                                    normalized
                                )
                        };
                    }
                )
            }
        );

        res.status(200).send('Toggled Batch');
    }));

}
