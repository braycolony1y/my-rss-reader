import { authMiddleware } from '../middleware/auth.js';
import { setClusteringModel } from '../../smart-news.js';
import { normalizeStateUrl } from '../utils/article-utils.js';
import { publishAppEvent } from '../events.js';

function parseVozReadCursor(value) {
    if (value == null) return null;
    try {
        const parsed = typeof value === 'string' && value.trim().startsWith('{')
            ? JSON.parse(value)
            : { index: Number(value) || 0 };
        const index = Number(parsed?.index) || 0;
        const absId = Number(parsed?.absId) || 0;
        const page = Number(parsed?.page) || 0;
        return { raw: value, index, absId, page };
    } catch {
        return null;
    }
}

function newerVozReadCursor(currentValue, incomingValue) {
    const current = parseVozReadCursor(currentValue);
    const incoming = parseVozReadCursor(incomingValue);
    if (!current) return incomingValue;
    if (!incoming) return currentValue;
    // Permanent XenForo post IDs are the strongest monotonic anchor. Fall
    // back to the visible post index for legacy entries without absId.
    if (current.absId && incoming.absId) return incoming.absId >= current.absId ? incomingValue : currentValue;
    if (incoming.index > current.index) return incomingValue;
    if (incoming.index < current.index) return currentValue;
    return incoming.page >= current.page ? incomingValue : currentValue;
}

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
                recentReadAt: await env.RSS_DATA.get('recentReadAt', { type: 'json' }) || {},
                categoryOrder: await env.RSS_DATA.get('categoryOrder', { type: 'json' }) || [],
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

            let requestedValue = value;
            if (key.startsWith('voz_last_read_post_')) {
                const currentPrefs = await env.RSS_DATA.get('userPreferences', { type: 'json' }) || {};
                requestedValue = newerVozReadCursor(currentPrefs[key], value);
            }

            const updatedPreferences = await boardCache.updatePreference(key, requestedValue);
            const storedValue = updatedPreferences?.[key];
            if (key === 'clusteringModel') setClusteringModel(storedValue);
            if (key === 'boardFolderMappings') {
                await boardCache?.reconcileMembership();
                void boardCache?.tick().catch(error => console.warn('[CACHE MEMBERSHIP]', error.message));
            }

            publishAppEvent(
                'user-state-changed',
                {
                    kind: 'preference',
                    key,
                    value: storedValue
                }
            );

            res.json({ success: true, key, value: storedValue });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/recently-read', authMiddleware, serializeStateWrite(async (req, res) => {
        const normLink = normalizeStateUrl(req.body?.link);
        if (!normLink) return res.status(400).json({ error: 'Missing link' });

        const recentReadAt = await env.RSS_DATA.get('recentReadAt', { type: 'json' }) || {};
        const at = Date.now();
        recentReadAt[normLink] = Math.max(Number(recentReadAt[normLink]) || 0, at);

        // Bound durable history independently of read/unread state. The view
        // itself uses a seven-day window, while retaining extra entries makes
        // brief clock/offline gaps harmless.
        const entries = Object.entries(recentReadAt)
            .filter(([, value]) => Number.isFinite(Number(value)) && Number(value) > 0)
            .sort((a, b) => Number(b[1]) - Number(a[1]))
            .slice(0, 4000);
        const bounded = Object.fromEntries(entries);
        await env.RSS_DATA.put('recentReadAt', JSON.stringify(bounded));

        publishAppEvent('user-state-changed', {
            kind: 'recent-read',
            link: normLink,
            at: bounded[normLink] || at
        });

        res.json({ success: true, link: normLink, at: bounded[normLink] || at });
    }));

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
