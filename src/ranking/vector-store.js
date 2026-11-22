// Read-only, lazily warmed access to the existing multilingual-e5-small vectors that the
// clustering already computed and persisted (smart-embeddings-worker.json plus its incremental
// parts). Ranking never computes embeddings itself; a missing vector simply means the ranker
// runs with its e5 features neutral for that story (see score.js).
import { EMBEDDING_CACHE_FILE } from '../smart/embeddings/config.js';
import { embeddingCacheKey } from '../smart/embeddings/index.js';
import { loadIncrementalEmbeddingSubset } from '../smart/embeddings/incremental-cache.js';
import { unit } from './features.js';

const MAX_VECTORS = 20000;
const MISS_TTL_MS = 5 * 60000;

function decode(encoded) {
  const buf = Buffer.from(String(encoded), 'base64');
  return unit(new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));
}

/**
 * The default store is inert (no vectors, no disk access) when RANKING_VECTORS=off and under
 * `node --test`, so unit tests never read the real 300 MB cache; tests that need vectors inject
 * `load` explicitly.
 */
function defaultEnabled() {
  return !/^(0|off|false)$/i.test(process.env.RANKING_VECTORS || '') && !process.env.NODE_TEST_CONTEXT;
}

/**
 * @param {object} [options]
 * @param {string} [options.file]  embedding cache file
 * @param {Function} [options.load] (file, keys:Set, importEntries) => Promise, defaults to the incremental cache reader (an injected loader is always enabled)
 * @param {Function} [options.keyOf] article -> cache key
 * @param {Function} [options.now]
 * @param {boolean} [options.enabled] false = never load anything
 */
export function createVectorStore({ file = EMBEDDING_CACHE_FILE, load, keyOf = embeddingCacheKey, now = Date.now, enabled = load ? true : defaultEnabled() } = {}) {
  load ||= loadIncrementalEmbeddingSubset;
  const vectors = new Map();      // key -> Float32Array (unit)
  const misses = new Map();       // key -> time of the last failed lookup
  const keys = new WeakMap();     // article object -> key
  let inflight = null, queued = null, revision = 0;

  const key = article => { let k = keys.get(article); if (!k) { k = keyOf(article); keys.set(article, k); } return k; };

  async function fill(wanted) {
    const found = new Set();
    try {
      await load(file, wanted, entries => {
        for (const [k, encoded] of Object.entries(entries)) { vectors.set(k, decode(encoded)); found.add(k); }
      });
    } catch (error) { if (error?.code !== 'ENOENT') console.warn('[RANKING] Could not read embedding vectors:', error.message); }
    const t = now();
    for (const k of wanted) if (!found.has(k)) misses.set(k, t);
    while (vectors.size > MAX_VECTORS) vectors.delete(vectors.keys().next().value);
    while (misses.size > MAX_VECTORS) misses.delete(misses.keys().next().value);
    if (found.size) revision++;
  }

  return {
    /** Vector of an article or null. Synchronous; never touches the disk. */
    get(article) { return vectors.get(key(article)) || null; },
    /** Bumps whenever new vectors become available, so cached rankings can be invalidated. */
    get revision() { return revision; },
    /**
     * Ensure vectors for these articles are loaded (single flight, resumable). Resolves when the
     * load that covers them finished; callers may race it against a timeout and rank degraded.
     */
    warm(articles) {
      if (!enabled) return null;
      const t = now(), wanted = new Set();
      for (const a of articles) {
        const k = key(a);
        if (!vectors.has(k) && !(misses.get(k) > t - MISS_TTL_MS)) wanted.add(k);
      }
      if (!wanted.size) return inflight;
      if (inflight) { queued = new Set([...(queued || []), ...wanted]); return inflight; }
      const run = async wantedKeys => {
        await fill(wantedKeys);
        if (queued) { const next = queued; queued = null; await run(next); }
      };
      inflight = run(wanted).finally(() => { inflight = null; });
      return inflight;
    },
    stats() { return { vectors: vectors.size, misses: misses.size, loading: Boolean(inflight), revision }; }
  };
}
