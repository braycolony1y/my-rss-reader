import { readMany } from '../database/read-many.js';
import { authMiddleware } from '../middleware/auth.js';
import { normalizeStateUrl } from '../utils/article-utils.js';
import { publishAppEvent } from '../events.js';
import { cleanGoogleNewsDestination, googleNewsArticleId } from '../articles/google-news-decode.js';

async function articleStateAliases(db, links) {
    const stateLinks = new Set(links.map(normalizeStateUrl));
    const wrappers = [...stateLinks].filter(link => googleNewsArticleId(link));
    const aliases = new Map();
    if (wrappers.length) {
        const mappings = db.getEntries
            ? await db.getEntries('googleNewsUrlCache', wrappers)
            : await db.get('googleNewsUrlCache', { type: 'json' });
        for (const wrapper of wrappers) {
            const mapping = mappings?.[wrapper];
            if (mapping?.permanentFailure) continue;
            const stored = mapping?.resolvedUrl;
            const canonical = cleanGoogleNewsDestination(stored);
            if (!canonical) continue;
            const destination = [stored, canonical].map(normalizeStateUrl).find(link => stateLinks.has(link));
            if (destination) aliases.set(wrapper, destination);
        }
    }
    return aliases;
}

async function capArticleStates(db, links) {
    const limit = 2000;
    if (links.length <= limit) return links;
    const aliases = await articleStateAliases(db, links);
    const identity = value => {
        const link = normalizeStateUrl(value);
        return aliases.get(link) || link;
    };
    const keep = new Set();
    for (let i = links.length - 1; i >= 0 && keep.size < limit; i--) keep.add(identity(links[i]));
    return links.filter(link => keep.has(identity(link)));
}

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
} = {}) {
    let stateWrites = Promise.resolve();
    const serializeStateWrite = handler => (req, res) => {
        const operation = stateWrites.then(() => handler(req, res));
        stateWrites = operation.catch(() => {});
        return operation;
    };

    app.get('/api/user-states', authMiddleware, async (req, res) => {
        try {
            const values=await readMany(env.RSS_DATA,['userPreferences','readStates','savedStates','boardStates',
                'hiddenStates','recentReadAt','categoryOrder'],{shared:true});
            const prefs=values.userPreferences||{};
            const hiddenStates = values.hiddenStates || [];
            const hiddenStateAliases = await articleStateAliases(env.RSS_DATA, hiddenStates);
            res.setHeader('Cache-Control', 'no-store');
            res.json({
                readStates:values.readStates||[],savedStates:values.savedStates||[],boardStates:values.boardStates||[],
                hiddenStates, hiddenStateAliases: Object.fromEntries(hiddenStateAliases),
                recentReadAt:values.recentReadAt||{},categoryOrder:values.categoryOrder||[],
                userPreferences:prefs
            });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/user-preferences', authMiddleware, async (req, res) => {
        try {
            const { key, value } = req.body;
            if (!key) return res.status(400).json({ error: 'Missing key' });
            let requestedValue = value;
            if (key.startsWith('voz_last_read_post_')) {
                const currentPrefs = await env.RSS_DATA.get('userPreferences', { type: 'json' }) || {};
                requestedValue = newerVozReadCursor(currentPrefs[key], value);
            }

            const updatedPreferences = await boardCache.updatePreference(key, requestedValue);
            const storedValue = updatedPreferences?.[key];
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
        stateArray = await capArticleStates(env.RSS_DATA, stateArray);
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

        stateArray = await capArticleStates(env.RSS_DATA, Array.from(stateSet));
        stateSet = new Set(stateArray);

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
