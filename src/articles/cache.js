import { CONTENT_RETENTION_MS, deletionTime, archiveExpiry } from './retention.js';
import { canonicalIdentity } from '../board/thread-model.js';
import { normalizeStoredPostTimes } from './source-time.js';
import { normalizeArticleSourceUrl } from '../article-source-state.js';
import { fnv1a, normalizeStateUrl } from '../utils/article-utils.js';
import path from 'path';
import fs from 'fs/promises';
import { isUnsafeVozThreadPayload, isVozThreadUrl } from '../voz-thread-state.js';
import { normalizeCachedArticleForSource, enhanceArticleResultForSource, assertArticleResultAcceptedBySource } from './source-results.js';

export function createArticleCache({
    env,
    _writeJsonAtomic,
} = {}) {
    const ARTICLE_CACHE_DIR = './article_cache';

    const ARTICLE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

    // NOTE: If you change anything about how articles are parsed, fetched, or sanitized (such as improving image extraction, video embeds, etc), you MUST bump this version to force a re-fetch of existing cached articles.
    // Normal reads expire after seven days, but the underlying last-known-good
    // file remains available longer in case the publisher later removes the page.
    const ARTICLE_CACHE_LAST_KNOWN_TTL_MS = CONTENT_RETENTION_MS;

    const ARTICLE_CACHE_VERSION = 56;

    let _articleCacheIndex = null;
    const cardImages = new Map();

    function articleCacheBasename(url) {
        const canonicalUrl = normalizeArticleSourceUrl(url).replace(/\/unread\/?(?:[?#].*)?$/i, '');
        return fnv1a(canonicalUrl) + '.json';
    }

    function articleCacheFilename(url) {
        return path.join(ARTICLE_CACHE_DIR, articleCacheBasename(url));
    }

    async function _initArticleCacheIndex() {
        if (_articleCacheIndex !== null) return;
        _articleCacheIndex = new Map();
        try {
            await fs.mkdir(ARTICLE_CACHE_DIR, { recursive: true });
            const files = await fs.readdir(ARTICLE_CACHE_DIR);
            let cursor = 0;
            // Bounded parallel reads avoid one event-loop round trip per file
            // during busy startup (large caches contain tens of thousands).
            await Promise.all(Array.from({ length: 16 }, async () => {
              while (cursor < files.length) {
                const name = files[cursor++];
                // Hidden JSON files are application state, not article cache.
                if (
                    name.startsWith('.') ||
                    !name.endsWith('.json')
                ) continue;
                try {
                    // Regex extraction is much faster than JSON.parse for large HTML blobs
                    const content = await fs.readFile(path.join(ARTICLE_CACHE_DIR, name), 'utf-8');
                    const versionMatch = content.match(/"version":\s*(\d+)/);
                    const cachedAtMatch = content.match(/"cachedAt":\s*(\d+)/);
                    const urlMatch = content.match(/"url":\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
                    const sourceDeletedMatch = content.match(/"sourceDeleted":\s*true/);
                    _articleCacheIndex.set(name, {
                        version: versionMatch ? parseInt(versionMatch[1]) : 0,
                        cachedAt: cachedAtMatch ? parseInt(cachedAtMatch[1]) : 0,
                        url: urlMatch ? JSON.parse(`"${urlMatch[1]}"`) : null,
                        sourceDeleted: Boolean(sourceDeletedMatch),
                        deletedDetectedAt: content.match(/"deletedDetectedAt":\s*"([^"\n]+)"/)?.[1] || null
                    });
                } catch (e) {
                    _articleCacheIndex.set(name, { version: 0, cachedAt: 0, url: null });
                }
              }
            }));
        } catch (e) {
            console.error('[ARTICLE CACHE] Failed to init index:', e.message);
        }
    }

    async function getCachedArticle(url) {
        const name = articleCacheBasename(url);
        const filename = path.join(ARTICLE_CACHE_DIR, name);
        try {
            const cached = JSON.parse(await fs.readFile(filename, 'utf-8'));
            if (cached.result?.sourceDeleted && Date.now() >= deletionTime({ ...cached.result, cachedAt: cached.cachedAt }) + CONTENT_RETENTION_MS && (await getArticleRetention(url, cached.cachedAt)).expiresAt <= Date.now()) return null;
            const isExpired = Date.now() - cached.cachedAt >= ARTICLE_CACHE_TTL_MS;
            if (!cached.cachedAt || !cached.result?.content) {
                await fs.unlink(filename).catch(() => {});
                if (_articleCacheIndex !== null) _articleCacheIndex.delete(name);
                return null;
            }
            if (isUnsafeVozThreadPayload(url, cached.result) && cached.result?.sourceDeleted !== true) {
                console.warn(`[ARTICLE CACHE] Ignoring VOZ error payload for ${url}`);
                return null;
            }
            if (cached.version !== ARTICLE_CACHE_VERSION) {
                // Source-specific cleanups can safely upgrade an otherwise good
                // cached article without making the reader wait for the publisher
                // again. This is especially important for authenticated sources
                // that may challenge a later network request.
                const normalized = normalizeCachedArticleForSource(url, cached.result);
                const migrated = enhanceArticleResultForSource(url, normalized, { cacheMigration: true });
                if (migrated?.content && migrated.content !== cached.result.content) {
                    try {
                        assertArticleResultAcceptedBySource(url, migrated);
                        if (await cacheArticleResult(url, migrated)) return migrated;
                    } catch (error) {
                        console.warn(`[ARTICLE CACHE] Could not migrate cached parser output for ${url}: ${error.message}`);
                    }
                }
            }
            if (isExpired || cached.version !== ARTICLE_CACHE_VERSION) {
                // Saved and board entries are intentional archives. Read their
                // current database-backed state and compare canonical URLs.
                let isProtected = cached.result?.sourceDeleted === true;
                if (!isProtected) {
                    isProtected = true;
                    try {
                        const [savedStates, boardStates] = await Promise.all([
                            env.RSS_DATA.get('savedStates', { type: 'json' }),
                            env.RSS_DATA.get('boardStates', { type: 'json' })
                        ]);
                        const normalizedUrl = normalizeStateUrl(url);
                        isProtected = [...(savedStates || []), ...(boardStates || [])]
                            .some(item => normalizeStateUrl(item) === normalizedUrl);
                    } catch (error) {
                        // Fail closed: a transient state-read error must never erase
                        // the only archived copy of an article.
                        console.warn('[ARTICLE CACHE] Could not verify archive protection:', error.message);
                    }
                }
                if (!isProtected) {
                    // Keep the stale file as last-known-good until a replacement
                    // has been fetched and validated. A terminal 404/410 response
                    // can then preserve this copy instead of losing the article.
                    return null;
                }
            }
            const normalizedResult = normalizeCachedArticleForSource(url, { ...cached.result, ...(isVozThreadUrl(url) ? { cached_at: cached.result.cached_at || new Date(cached.cachedAt).toISOString() } : {}), content: normalizeStoredPostTimes(cached.result.content, { cached_at: new Date(cached.cachedAt).toISOString(), unavailable: cached.result.sourceDeleted === true }) });
            try {
                return assertArticleResultAcceptedBySource(url, normalizedResult);
            } catch (error) {
                console.warn(`[ARTICLE CACHE] Ignoring source-invalid cache for ${url}: ${error.message}`);
                return null;
            }
        } catch (e) {
            return null;
        }
    }

    async function readLastKnownCachedArticle(url) {
        try {
            const cached = JSON.parse(await fs.readFile(articleCacheFilename(url), 'utf-8'));
            const result = cached?.result;
            if (result?.sourceDeleted && Date.now() >= deletionTime({ ...result, cachedAt: cached.cachedAt }) + CONTENT_RETENTION_MS && (await getArticleRetention(url, cached.cachedAt)).expiresAt <= Date.now()) return null;
            if (!result?.content) return null;
            if (isUnsafeVozThreadPayload(url, result) && result.sourceDeleted !== true) return null;
            return cached;
        } catch (error) {
            return null;
        }
    }

    async function getLastKnownCachedArticle(url) {
        try {
            const cached = await readLastKnownCachedArticle(url);
            if (!cached) return null;
            const result = cached.result;
            return normalizeCachedArticleForSource(url, { ...result, ...(isVozThreadUrl(url) ? { cached_at: result.cached_at || (cached.cachedAt ? new Date(cached.cachedAt).toISOString() : null) } : {}), content: normalizeStoredPostTimes(result.content, { cached_at: cached.cachedAt ? new Date(cached.cachedAt).toISOString() : null, unavailable: result.sourceDeleted === true }) });
        } catch {
            return null;
        }
    }

    async function getLastKnownCachedArticleImage(url) {
        // Cards need only the image. Preserve validity/retention checks without
        // parsing and rewriting every post in the cached thread body.
        const filename = articleCacheFilename(url);
        try {
            const stat = await fs.stat(filename);
            const fingerprint = `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`;
            const existing = cardImages.get(filename);
            if (existing?.fingerprint === fingerprint) return existing.image;
            const cached = await readLastKnownCachedArticle(url);
            const image = cached?.result?.image || null;
            // Deleted snapshots need a fresh retention check on every lookup.
            if (cached && !cached.result.sourceDeleted) {
                cardImages.delete(filename);
                cardImages.set(filename, { fingerprint, image });
                while (cardImages.size > 512) cardImages.delete(cardImages.keys().next().value);
            } else cardImages.delete(filename);
            return image;
        } catch {
            cardImages.delete(filename);
            return null;
        }
    }

    async function getCachedArticleMetadata(url) {
        const cached = await readLastKnownCachedArticle(url);
        if (!cached) return null;
        return { sourceDeleted: cached.result.sourceDeleted === true };
    }

    async function cacheArticleResult(url, result) {
        result = normalizeCachedArticleForSource(url, result);
        if (!result?.content) return false;
        try {
            assertArticleResultAcceptedBySource(url, result);
        } catch (error) {
            console.warn(`[ARTICLE CACHE] Refusing source-invalid result for ${url}: ${error.message}`);
            return false;
        }
        if (isUnsafeVozThreadPayload(url, result) && result.sourceDeleted !== true) {
            console.warn(`[ARTICLE CACHE] Refusing to overwrite ${url} with a VOZ error page.`);
            return false;
        }
        try {
            await fs.mkdir(ARTICLE_CACHE_DIR, { recursive: true });
            const name = articleCacheBasename(url);
            const filename = path.join(ARTICLE_CACHE_DIR, name);
            try {
                const existingFile = JSON.parse(await fs.readFile(filename, 'utf-8'));
                const existing = existingFile?.result;
                if (result.sourceDeleted) result = { ...result, deletedDetectedAt: existing?.deletedDetectedAt || (existing?.sourceDeleted ? new Date(existingFile.cachedAt).toISOString() : result.deletedDetectedAt) || new Date().toISOString() };
                if (existing?.sourceDeleted === true && result.sourceDeleted !== true) {
                    console.warn(`[ARTICLE CACHE] Refusing to overwrite confirmed deleted-source snapshot for ${url}.`);
                    return false;
                }
                if (isVozThreadUrl(url)) {
                    const existingPostCount = (existing?.content?.match(/class=["']voz-post["']/gi) || []).length;
                    const incomingPostCount = (result.content.match(/class=["']voz-post["']/gi) || []).length;
                    if (existingPostCount > 0 && incomingPostCount < existingPostCount) {
                        console.warn(`[ARTICLE CACHE] Refusing VOZ quality downgrade for ${url}: ${existingPostCount} posts -> ${incomingPostCount} posts.`);
                        return false;
                    }
                }
            } catch (error) {
                // No previous cache (or an unreadable one): the validated
                // incoming payload may establish the initial entry.
            }
            if (result.sourceDeleted && !result.deletedDetectedAt) result = { ...result, deletedDetectedAt: new Date().toISOString() };
            await _writeJsonAtomic(filename, { version: ARTICLE_CACHE_VERSION, cachedAt: Date.now(), url, result });
            if (_articleCacheIndex !== null) {
                _articleCacheIndex.set(name, {
                    version: ARTICLE_CACHE_VERSION,
                    cachedAt: Date.now(),
                    url,
                    sourceDeleted: result.sourceDeleted === true,
                    deletedDetectedAt: result.deletedDetectedAt || null
                });
            }
            return true;
        } catch (error) {
            console.error('[ARTICLE CACHE] Could not save article:', error.message);
            return false;
        }
    }

    async function deleteCachedArticle(url) {
        const name = articleCacheBasename(url);
        await fs.unlink(path.join(ARTICLE_CACHE_DIR, name)).catch(() => {});
        if (_articleCacheIndex !== null) _articleCacheIndex.delete(name);
    }

    async function getArticleRetention(url, fallbackCachedAt = 0) {
        await _initArticleCacheIndex();
        const normalized = normalizeStateUrl(url);
        const [saved, board, members] = await Promise.all([
            env.RSS_DATA.get('savedStates', { type: 'json' }),
            env.RSS_DATA.get('boardStates', { type: 'json' }),
            env.RSS_DATA.get('cacheMembers', { type: 'json' })
        ]);
        let protectedArchive = [...(saved || []), ...(board || [])].some(value => normalizeStateUrl(value) === normalized);
        if (protectedArchive) return { protected: true, expiresAt: Infinity };
        let cachedAt = 0, deletedExpiry = Infinity;
        for (const meta of _articleCacheIndex.values()) {
            if (!meta.url || normalizeStateUrl(meta.url) !== normalized) continue;
            cachedAt = Math.max(cachedAt, meta.cachedAt || 0);
            if (meta.sourceDeleted) deletedExpiry = Math.min(deletedExpiry, deletionTime(meta) + CONTENT_RETENTION_MS);
        }
        const member = members?.[canonicalIdentity(url)];
        const forcedExpiry = member?.left_cache_at ? archiveExpiry({ ...member, retention_protected: false }) : Math.min(deletedExpiry, archiveExpiry({ ...member, retention_protected: false }));
        if (Number.isFinite(forcedExpiry)) return { protected: false, expiresAt: forcedExpiry };
        return { protected: protectedArchive, expiresAt: (cachedAt || fallbackCachedAt) + ARTICLE_CACHE_LAST_KNOWN_TTL_MS };
    }

    async function cleanupArticleCache() {
        try {
            await _initArticleCacheIndex();

            const savedStatesForPruning = await env.RSS_DATA.get('savedStates', { type: 'json' }) || [];
            const boardStatesForPruning = await env.RSS_DATA.get('boardStates', { type: 'json' }) || [];
            const protectedUrls = new Set(
                [...savedStatesForPruning, ...boardStatesForPruning].map(normalizeStateUrl).filter(Boolean)
            );

            const deletedThreads = new Map();
            for (const meta of _articleCacheIndex.values()) {
                if (!meta.sourceDeleted || !meta.url) continue;
                const key = normalizeStateUrl(meta.url);
                deletedThreads.set(key, Math.min(deletedThreads.get(key) || Infinity, deletionTime(meta) + CONTENT_RETENTION_MS));
            }
            const members = await env.RSS_DATA.get('cacheMembers', { type: 'json' }) || {};
            for (const member of Object.values(members)) {
                if (!member.url) continue;
                const key = normalizeStateUrl(member.url);
                if (member.left_cache_at) deletedThreads.set(key, archiveExpiry({ ...member, retention_protected: false }));
                else if (member.source_removed && member.removed_at) deletedThreads.set(key, Math.min(deletedThreads.get(key) || Infinity, Date.parse(member.removed_at) + CONTENT_RETENTION_MS));
            }
            let removed = 0;
            for (const [name, meta] of _articleCacheIndex.entries()) {
                const filename = path.join(ARTICLE_CACHE_DIR, name);
                const deletedExpiry = meta.url ? deletedThreads.get(normalizeStateUrl(meta.url)) : undefined;
                const isLastKnownExpired = deletedExpiry !== undefined ? Date.now() >= deletedExpiry : Date.now() - meta.cachedAt >= ARTICLE_CACHE_LAST_KNOWN_TTL_MS;

                if (!meta.cachedAt || isLastKnownExpired) {
                    if (meta.url && protectedUrls.has(normalizeStateUrl(meta.url))) {
                        // Protected, do not delete
                    } else {
                        await fs.unlink(filename).catch(() => {});
                        _articleCacheIndex.delete(name);
                        removed++;
                    }
                }
            }
            if (removed) console.log(`[ARTICLE CACHE] Removed ${removed} expired or invalid entries.`);
        } catch (error) {
            console.error('[ARTICLE CACHE] Cleanup failed:', error.message);
        }
    }

    return {
        getCachedArticleMetadata,
        getLastKnownCachedArticleImage,
        getLastKnownCachedArticle,
        cacheArticleResult,
        getCachedArticle,
        _initArticleCacheIndex,
        get _articleCacheIndex() { return _articleCacheIndex; },
        deleteCachedArticle,
        ARTICLE_CACHE_DIR,
        cleanupArticleCache,
        getArticleRetention
    };
}
