# Performance Audit — my-rss-reader

> **Audit started:** 2026-07-30  
> **Current phase:** DISCOVERY (Phase 1 complete)  
> **Auditor scope:** Performance, scalability, algorithms, data structures, memory, CPU, database efficiency, network, RSS processing, reliability, resource utilization, architectural bottlenecks.

---

## Table of Contents

1. [System Profile](#system-profile)
2. [Findings](#findings)
   - [CRITICAL](#critical)
   - [HIGH](#high)
   - [MEDIUM](#medium)
   - [LOW](#low)
3. [Not Yet Audited](#not-yet-audited)

---

## System Profile

| Metric | Value |
|---|---|
| Runtime | Node.js, single-process, systemd-managed |
| Framework | Express 5 |
| Database | In-memory JS object (`_dbCache`) with write-through to JSON files |
| `database.json` size | ~7.4 MB |
| `smart-data.json` size | ~7.5 MB |
| Article count | ~6,484 |
| Smart clusters | ~3,844 |
| Feed count | 43 |
| Article cache (disk) | ~9,695 files / 170 MB |
| `server.js` | 5,548 lines / 278 KB |
| `readStates` entries | ~821 |
| `savedStates` entries | ~13 |
| Embedding model | `@xenova/transformers` (multilingual-e5-small) |
| AI summary engine | Multi-key Gemini + Qwen |

---

## Findings

### CRITICAL

#### C-1: `/api/data` — O(n×m) linear scans on state arrays per article

**Location:** `server.js:3080-3090, 3150-3154, 3188, 3192, 3268`

**Problem:** `readStates`, `savedStates`, `boardStates`, and `hiddenStates` are plain arrays. The code calls `.includes()` on them inside tight per-article loops (e.g., `visibleArticles.forEach` for unread counting, filtering by hide-read, recent tab). With ~6,400 articles and ~820 readStates, the unread-count loop alone performs ~5.2 million string comparisons per `/api/data` request.

The `readStates.indexOf(b.link) - readStates.indexOf(a.link)` sort on line 3188 is O(n²) — each comparison inside `.sort()` does two linear scans.

**Impact:** This is the **most frequently called endpoint** (every page load, every tab switch, every infinite-scroll page). At scale (double the feed count → ~13k articles, ~2k readStates), response time will grow quadratically.

**Recommendation:** Convert state arrays to `Set` objects at the start of the request handler. The `.indexOf`-based sort should be replaced by a `Map<link, index>` lookup.

---

#### C-2: Full database serialization on every single write

**Location:** `server.js:796-828` (`_persistToDisk`)

**Problem:** Every call to `env.RSS_DATA.put()` serializes the **entire** `_dbCache` object (articles + feeds + all states) into JSON and writes it atomically to `database.json`. With a combined size of ~15 MB (database.json + smart-data.json), a single toggle of "mark as read" triggers:

1. `JSON.stringify()` of ~7.4 MB → CPU spike
2. Write 7.4 MB temp file → I/O spike
3. `fs.rename()` → I/O
4. Plus a `.backup` write of the **previous** 7.4 MB snapshot

Two full serializations + two disk writes for flipping one boolean.

During `syncFeeds`, which writes `articles`, `feeds`, `readStates`, and `hiddenStates` in sequence, this serialization cascade happens 4+ times back-to-back.

**Impact:** Under load (sync cycle + user reading articles), this creates sustained I/O and CPU contention. On resource-constrained VPS, this is the most likely cause of slow responses and potential OOM kills during sync.

**Recommendation:** 
- Write only the changed key's data to a per-key file (e.g., `db/articles.json`, `db/readStates.json`), not the entire database on every put.
- Or: coalesce/debounce writes with a dirty-key tracker and a single flush timer.

---

#### C-3: Duplicate deduplication logic uses `.find()` inside loop — O(n²)

**Location:** `server.js:2468-2487`

**Problem:** The deduplication pass after sync merges articles from `newArticles` and `existingArticles`. When a duplicate is found (line 2480), it uses:
```js
const existing = uniqueArticles.find(a => a.link === article.link || ...)
```
This is a linear scan inside a loop that iterates over all articles. With ~6,400 articles, worst case is ~41 million comparisons.

**Impact:** Measurable CPU time during every sync cycle. Will degrade proportionally as the article corpus grows.

**Recommendation:** Use a `Map<link, article>` alongside `seenLinks` to provide O(1) lookup for the merge step.

---

### HIGH

#### H-1: `/api/data` sends full readStates/savedStates/boardStates/hiddenStates arrays to the client every request

**Location:** `server.js:3292-3305`

**Problem:** Every `/api/data` response includes the full `readStates` array (821 strings), `savedStates`, `boardStates`, and `hiddenStates`. These are URL strings averaging ~80 bytes each. The readStates alone add ~65 KB of redundant data to every API response. The client already has these in memory and only needs deltas.

**Impact:** Wasted bandwidth, slower JSON serialization, slower client-side parsing. Especially impactful on mobile networks.

**Recommendation:** Send state arrays only on initial load. Subsequent requests should receive only a version/hash, and the client should reconcile via a lightweight diff endpoint.

---

#### H-2: `syncFeeds` processes all feeds sequentially with no concurrency

**Location:** `server.js:2116-2452` (feed loop), `server.js:5483-5492` (sequential sync loop)

**Problem:** The `startSequentialSyncLoop` processes each of the 43 feeds one at a time, with a 2-second delay between each. RSS fetching is I/O-bound (network wait), so sequential processing wastes time that could be used for parallel I/O.

A full cycle takes at minimum 43 × 2s delay = 86 seconds just in inter-feed delays, plus actual fetch/parse time per feed. Total cycle time likely exceeds 5-8 minutes.

**Impact:** Stale feed data. With a 10-minute minimum cycle and 43 feeds, the effective refresh rate per feed is ~10 minutes at best. Adding more feeds worsens this linearly.

**Recommendation:** Process feeds in batches of 4-6 concurrent fetches (bounded semaphore). This would reduce cycle time by 3-5x while staying within reasonable connection limits.

---

#### H-3: `cleanupArticleCache` reads and JSON-parses every cached file sequentially

**Location:** `server.js:116-147`

**Problem:** The cleanup function reads all ~9,695 article cache files from disk, parsing each JSON file individually to check its `cachedAt` and `version`. This runs hourly and at startup.

**Impact:** Significant I/O burst. At 170 MB across 9,695 files, each cleanup cycle reads the entire cache. On a VPS with slow disk I/O, this can starve concurrent article requests.

**Recommendation:** Maintain an in-memory index of `{hash → cachedAt, version, url}` populated on first scan, updated on cache writes. Subsequent cleanup runs only need to check the index, not re-read files.

---

#### H-4: `content-filter-preview` loads entire article + smartClusters corpus into memory per request

**Location:** `server.js:2704-2778`

**Problem:** Every content-filter-preview request loads all articles AND all smartClusters, iterates over every one of them, and does substring matching with every keyword. This is O(articles × keywords × fields).

**Impact:** With ~10k combined articles/clusters and multiple keywords, this endpoint can block the event loop for a noticeable duration. It's called interactively as the user types keywords (debounced at 500ms).

**Recommendation:** Consider pre-computing a keyword index or caching the filter results with a short TTL.

---

#### H-5: `_jsonParsedCache` can return mutable references, causing silent data corruption

**Location:** `server.js:864-868`

**Problem:** The JSON parse cache stores the *same* parsed object reference and returns it to all callers. If any consumer mutates the returned array (e.g., `.push()`, `.sort()`, property assignment), the cached copy is corrupted for all subsequent reads until the next `put()`.

Multiple code paths do mutate returned data: `syncFeeds` calls `.push()` on returned arrays, the `hot_today` filter does in-place filtering, etc.

**Impact:** Potential for intermittent data corruption bugs that are extremely difficult to reproduce and debug.

**Recommendation:** Return `structuredClone()` or a fresh `JSON.parse()` from the cache, or document and enforce an immutability contract.

---

### MEDIUM

#### M-1: Smart news embedding pipeline loads a 120MB+ ML model into memory

**Location:** `smart-news.js:106-124` (`getEmbeddingVector`)

**Problem:** The `@xenova/transformers` pipeline lazily loads `Xenova/multilingual-e5-small` into memory. This model alone consumes 100-200 MB of heap. Combined with the ~15 MB database in memory, article cache I/O buffers, and Express overhead, this pushes total RSS memory to 400+ MB on a VPS likely provisioned with 1-2 GB.

**Impact:** High baseline memory usage. During sync cycles that trigger `global.gc()`, there may be long GC pauses (50-200ms) that block the event loop.

**Recommendation:** Monitor actual memory pressure via the `/health` endpoint. Consider if the embedding model can be lazy-unloaded after smart sync completes, or if a lighter-weight text similarity approach (TF-IDF + cosine) would suffice for the clustering use case.

---

#### M-2: `runUniversalTabPrefetch` loads full articles + smartClusters + blocked keywords per run

**Location:** `server.js:5346-5461`

**Problem:** This function runs every 30 minutes and at startup. It loads the full `articles` array, full `smartClusters`, processes blocked keywords, then iterates across every category to find top-5 per tab. It re-sorts the same dataset multiple times with different sort keys.

**Impact:** Redundant CPU and memory work. The sorted subsets could be computed once during sync and cached.

---

#### M-3: Google News URL cache has no size-bounded eviction — grows to 3,000 entries then hard-clips

**Location:** `server.js:2830-2893`

**Problem:** The `googleNewsUrlCache` object grows unboundedly in memory until the save timer fires, at which point it's sorted by `cachedAt` and hard-clipped to 3,000 entries. Between clips, all entries occupy memory.

**Impact:** Memory pressure from a potentially large in-memory object. The hard clip loses entries that may still be useful.

**Recommendation:** Use an LRU cache with a fixed max size.

---

#### M-4: `clear-article-cache` for Voz threads reads ALL cache files to find related pages

**Location:** `server.js:4260-4290`

**Problem:** When clearing cache for a Voz thread, the code reads `fs.readdir(ARTICLE_CACHE_DIR)` (9,695 files), then reads and JSON-parses each file to check if its URL contains the thread ID. This is O(n) disk reads for a single cache clear.

**Impact:** Slow endpoint response, heavy I/O burst.

**Recommendation:** Maintain a reverse index `threadId → [cacheFilenames]` or use the URL→filename hash function directly with known page URL patterns.

---

#### M-5: Regex-heavy HTML cleaning in `cleanArticleMarkup` runs multiple passes

**Location:** `server.js:3878-3983`

**Problem:** `cleanArticleMarkup` applies 30+ regex replacements, some in loops (line 3925: `for (let i = 0; i < 5; i++) cleaned = cleaned.replace(noisePattern, ...)`) and line 3980 (3 passes for empty elements). Each pass scans the entire HTML string.

For large articles (100KB+ of HTML), this is measurable CPU time.

**Impact:** Article extraction latency. Not individually critical, but compounds with the fallback strategy chain (up to 6 strategies × parsing per strategy).

---

#### M-6: `readStates.includes(a.link)` is used as a sort comparator in "recent" tab

**Location:** `server.js:3188`

**Problem:** `.sort((a, b) => readStates.indexOf(b.link) - readStates.indexOf(a.link))` — each `.indexOf()` is O(readStates.length). JavaScript's sort is O(n log n) comparisons, so the total is O(n × log(n) × readStates.length).

**Impact:** Slow "recent" tab rendering at scale.

---

### LOW

#### L-1: `fetchHistory` and `systemLogs` arrays grow unboundedly between prunes

**Location:** `server.js` (in-memory arrays, pruned on access)

**Problem:** These arrays are only pruned when their respective API endpoints are called. If no one views the logs for days, they grow indefinitely.

**Recommendation:** Prune on a timer or cap insertion.

---

#### L-2: Multiple `decodeGoogleNews` helper functions are duplicated

**Location:** `server.js:5052-5057, 5087-5091, 5191-5196, 5216-5221`

**Problem:** The same `decodeGoogleNews` inner function is defined independently in 4 different route handlers.

**Impact:** No performance impact, but increases the code surface area for the JS parser and adds to `server.js` bloat (5,548 lines).

---

#### L-3: Article cache filename uses SHA-256 but only needs collision resistance, not crypto security

**Location:** `server.js:65-67`

**Problem:** SHA-256 is used to hash URLs for cache filenames. A faster non-cryptographic hash (e.g., FNV-1a, xxHash) would be sufficient for this use case.

**Impact:** Negligible per-call (SHA-256 is fast), but it adds up across 9,695+ cache file operations.

---

## Phase 2 Findings

### CRITICAL

#### C-4: `collectGeminiRetryCandidates` — O(n²) quadratic pair-counting inside token index

**Location:** `smart-news.js:928-982`

**Problem:** The `collectGeminiRetryCandidates` function builds a token→groupId inverted index, then counts shared tokens between all pairs using a nested loop:

```js
for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
        const key = ids[i] < ids[j] ? ids[i] + '|' + ids[j] : ids[j] + '|' + ids[i];
        sharedCounts.set(key, (sharedCounts.get(key) || 0) + 1);
    }
}
```

Although tokens with `ids.length > 120` are skipped, common Vietnamese news tokens (e.g., "việt", "nam", "thị", "trường") will frequently appear in 50-100 groups. For a token appearing in 100 groups, this inner loop generates C(100,2) = 4,950 pair keys. Across all tokens, the `sharedCounts` Map can grow to hundreds of thousands of entries, each requiring a string concatenation and a Map lookup.

This runs **every smart sync cycle** when there are unmerged groups remaining after the first Gemini pass.

**Impact:** CPU-intensive Map churn. With ~330 tech articles (largest category), the retry candidate identification step can create significant GC pressure from the ephemeral string keys. The `sharedCounts` Map is not size-bounded.

**Recommendation:** Consider a more efficient pair-scoring approach: only compute scores for pairs that share at least one high-specificity token (e.g., filter the inverted index to tokens appearing in ≤20 groups before pair enumeration). Alternatively, use the embedding vectors directly — they're already computed by `prepareEmbeddings` — to find nearest neighbors in O(n log n) with a spatial index.

---

### HIGH

#### H-6: `applyGeminiMerges` — sequential per-category Gemini calls with 4.2s rate-limiting gaps

**Location:** `smart-news.js:984-1169`

**Problem:** The Gemini merge process iterates through 5 categories sequentially, with a mandatory 4.2-second pause between each API call. Categories are further chunked at 130 items each. For the typical scenario:
- `news_vietnam`: ~1 chunk → 1 call
- `news_world`: ~1 chunk → 1 call
- `finance_vietnam`: ~1 chunk → 1 call
- `finance_global`: ~1 chunk → 1 call
- `tech`: ~3 chunks → 3 calls

This totals ~7 Gemini API calls with 6 inter-call delays of 4.2s = **25.2 seconds of dead wait time** minimum. Add actual API latency (~2-5s per call) and the retry step, and the total Gemini phase likely takes **60-90 seconds**.

**Impact:** The smart sync cycle is dominated by Gemini wait time. This directly increases the gap between when a breaking news story arrives in the RSS feed and when it appears in the Smart view.

**Recommendation:** Since different categories are independent, consider sending category requests concurrently (with a small stagger to avoid burst rate limits). This could reduce the 60-90s Gemini phase to ~15-25s. Also, the retry pass (`collectGeminiRetryCandidates` → another Gemini call) adds another 4.2s+ wait after all categories are done.

---

#### H-7: `markAllAsRead` sends one HTTP POST per link — fan-out to N individual `/api/toggle` calls

**Location:** `script.js:1303-1309`

**Problem:** When the user clicks "Mark all as read", the frontend sends `Promise.allSettled` with one `fetch('/api/toggle')` POST per unread article link. If 40 articles are visible, this fires 40 simultaneous HTTP requests.

On the server side, each `/api/toggle` call triggers `withDbLock` → mutate state array → `env.RSS_DATA.put()` → full database serialization (C-2). So 40 mark-as-read clicks cause 40 sequential full `JSON.stringify()` + disk writes of `database.json`.

**Impact:** Server event loop blocked for potentially hundreds of milliseconds as 40 `_persistToDisk` calls serialize and write the full database 40 times in rapid succession. This combines multiplicatively with C-2.

**Recommendation:** Add a batch toggle endpoint (`/api/toggle-batch`) that accepts an array of links and performs a single `withDbLock` → bulk mutate → single `put()`. The existing `undoMarkAllRead` has the same fan-out problem.

---

#### H-8: `beautifyArticleHtml` runs DOMParser + 30+ regex passes + 4 empty-element cleanup passes on every article view

**Location:** `script.js:2030-2177`

**Problem:** Every time an article is opened (or a Voz thread page is navigated), the client runs `beautifyArticleHtml`, which:
1. Creates a DOMParser → parses the full HTML string into a DOM tree
2. Queries ALL elements (`doc.body.querySelectorAll('*')`) and tests each against a noise regex
3. Queries `div,section,ul` elements and computes link-to-text ratios
4. Searches for semantic boundaries with a regex + range calculation
5. Runs 4 passes of `querySelectorAll('p:empty,div:empty,span:empty,section:empty,figure:empty')`
6. Queries and processes all `img,video,audio`, all `a` elements, all `p,div,span,section` elements, all `table` elements

For Voz thread pages with 20+ posts (each containing quotes, embedded media, signatures), the HTML can be 200KB+. The `querySelectorAll('*')` on a 200KB DOM tree touches every single node.

**Impact:** Noticeable jank (frame drops) when opening large articles, especially on mobile. The 4-pass empty-element cleanup is particularly wasteful — a single pass in reverse document order would suffice.

**Recommendation:** 
- Move HTML sanitization to the server side (the server already has `cleanArticleMarkup`). Beautify once at cache time, not on every view.
- If client-side processing is required, reduce the `querySelectorAll('*')` to targeted selectors (elements with class/id/role attributes only).
- Replace the 4-pass empty-element loop with a single TreeWalker pass.

---

#### H-9: Frontend `readStates` is a plain array — `.includes()` used in reactive computed properties and filter loops

**Location:** `script.js:864-877, 1265, 1426`

**Problem:** The client-side `readStates` array mirrors the server-side issue (C-1). Alpine.js reactive expressions like `this.readStates.includes(a.link)` are called:
- On every article filter in `fetchData` (line 876-877): filters all articles against `readStates`
- On every `markAllAsRead` call (line 1265): scans `readStates` for every article + every related article
- On `syncUserStatesInBackground` (line 1426): re-filters all articles against updated `readStates`

With Alpine.js reactivity, any mutation to `readStates` (e.g., marking an article read) can trigger re-evaluation of template expressions that use `readStates`, causing cascading `.includes()` calls across the DOM.

**Impact:** On mobile with 800+ readStates and 40+ articles on screen, Alpine.js reactive updates involving `readStates` will be visibly slow.

**Recommendation:** Convert `readStates` to a `Set` (and similarly `savedStates`, `boardStates`, `hiddenStates`) in the Alpine.js data model. Replace `.includes()` with `.has()`. Requires careful handling since Alpine.js doesn't automatically track `Set.add()` mutations — wrap mutations in `this.readStates = new Set([...this.readStates, link])`.

---

### MEDIUM

#### M-7: `prepareEmbeddings` — embedding pipeline invoked for every article on every sync even if unchanged

**Location:** `smart-news.js:1446` (called from `sync`)

**Problem:** On every smart sync cycle, `prepareEmbeddings(candidates)` is called on the full candidate list (~1,000+ articles). The function checks if `article._vec` already exists, but articles loaded from `smartRawArticles` JSON storage don't carry the `_vec` field (it's stripped before persistence at line 1511-1516). This means **every sync re-computes embeddings for all articles**, even those that haven't changed.

The `_embeddingCache` (line 113-119) partially mitigates this by caching up to 2,000 embeddings by text key, but the cache is cleared at the end of each sync cycle (line 1577: `if (_embeddingCache.size > 2000) _embeddingCache.clear()`).

**Impact:** The ML embedding pipeline (`@xenova/transformers`) runs inference on ~1,000 text segments per sync cycle (~every 10 minutes). Each embedding takes ~5-20ms (CPU), so the full pipeline takes 5-20 seconds of CPU time per cycle. This is wasted work for the ~90% of articles that haven't changed.

**Recommendation:** Persist the embedding cache (e.g., a `smart-embeddings.json` keyed by article link → vector) across sync cycles, or raise the in-memory cache limit since the vectors are small (384 floats × 4 bytes = 1.5 KB each; 2,000 entries = ~3 MB).

---

#### M-8: Smart sync persists 6 separate `db.put()` calls in sequence — each triggering full serialization

**Location:** `smart-news.js:1519-1524`

**Problem:** At the end of every smart sync, 6 consecutive `db.put()` calls write:
1. `smartRawArticles` (1,809 articles as JSON)
2. `smartClusters` (3,844 clusters as JSON)
3. `smartClusterVersion`
4. `smartCandidateLinks`
5. `smartCandidateSignature`
6. `smartAiConfig`

Per C-2, each `put()` triggers a full `JSON.stringify()` + atomic write of the entire `smart-data.json` (7.5 MB). So the sync conclusion writes **45 MB** of data (6 × 7.5 MB) in rapid succession.

**Impact:** ~200-500ms of CPU for serialization + ~6 disk writes of 7.5 MB each. This is the tail-end of an already CPU-intensive sync cycle.

**Recommendation:** Batch these writes: either accumulate dirty keys and flush once at the end, or use a `putMany()` method that groups multiple mutations into a single serialize-and-write cycle.

---

#### M-9: `largestTimeConsistentGroup` — O(n²) brute-force search for time-consistent subsets

**Location:** `smart-news.js:818-835`

**Problem:** For each proposed Gemini merge, `largestTimeConsistentGroup` iterates over all group start times, then for each start time, iterates over all groups to find those fitting within the `EVENT_MATCH_WINDOW_MS` window. This is O(n²) where n = number of groups in a merge proposal.

Within each filter call, `Math.min(...times)` and `Math.max(...times)` are computed by spreading the articles array into `Math.min/Math.max`, which creates a temporary array on each call.

**Impact:** For typical merge proposals (2-5 groups), this is negligible. But the function is also called during the attachment reconciliation step (line 1142) for every unmerged group against every accepted cluster, making the outer loop O(unmerged × accepted_clusters × groups_per_cluster).

---

#### M-10: `handleCardHover` fires two parallel fetches — summary check + full article prefetch

**Location:** `script.js:1047-1092`

**Problem:** On every card hover (desktop), two independent `fetch()` calls fire:
1. `GET /api/summary?url=...` — checks for cached AI summary (after 200ms debounce)
2. `GET /api/article-content?url=...&prefetch=1` — fetches full article content (immediate, bypasses prefetch queue)

The article-content fetch is **not debounced** — it fires immediately when the user hovers over any card, even if they're just moving the mouse across the feed. Rapid mouse movement across 10 cards generates 10 simultaneous article fetch requests.

**Impact:** Network contention and server load from speculative fetches. Each `/api/article-content` request may trigger the full proxy cascade strategy chain (up to 6 network requests) for uncached articles. On a VPS with limited bandwidth, this can starve the actual article the user wants to read.

**Recommendation:** Debounce the article-content prefetch to at least 300-500ms (matching the summary check). Also consider limiting concurrent speculative prefetches to 2-3.

---

#### M-11: Summary queue model duplication — sequential try-catch chain through 3 providers per job

**Location:** `summary-engine.js:791-814`

**Problem:** For each summary job, the queue `_processLoop` tries 3 models in sequence:
1. `qwen-plus` (timeout: 90s)
2. `qwen3.6-flash` (timeout: 90s)
3. `gemini-3.5-flash` (timeout: 90s)

If `qwen-plus` fails, the user waits up to 90s before the fallback kicks in. The same 3-model cascade exists in `generateDeepAnalysis` (lines 525-561). Each model attempt makes a full HTTP request with 90-second timeout.

The `generateWithFallback` helper (line 331) also uses this pattern but is only a 2-level cascade.

**Impact:** Worst-case latency for a single summary: 270 seconds (3 × 90s timeouts). With `MAX_RETRIES = 2`, a persistently failing job can block the queue for up to 810 seconds (3 attempts × 270s). During this time, all other summary requests are queued behind it.

**Recommendation:** Use a shorter timeout for the first-choice provider (30s instead of 90s) since it's typically the fastest. Or run the first two providers concurrently with `Promise.race()` and cancel the loser.

---

#### M-12: VozSource `getBestImage` makes up to 3 sequential HTTP requests to external sites

**Location:** `src/sources/VozSource.js:3-90`

**Problem:** For Voz thread image extraction, `getBestImage` does:
1. Fetch the thread page directly (with cookies, 6s timeout)
2. If that fails, fetch via CF proxy
3. Then for each external link in the first post, fetch the linked page via CF proxy
4. If that fails, fetch via AllOrigins proxy

Each external link fetch is a full HTTP request to an unknown third-party site, serialized. If the first post contains 3 external links, this becomes 3 × 2 = 6 HTTP requests, each with potential latency.

This runs during RSS sync for every new Voz thread article.

**Impact:** A single Voz thread with external links can add 10+ seconds to the sync cycle. Since feeds are processed sequentially (H-2), this blocks all other feed syncs.

**Recommendation:** Apply a concurrency limit and a shorter timeout (3s) for the external link image extraction. Consider skipping image extraction entirely if a thumbnail is already available from the RSS feed.

---

### LOW

#### L-4: Smart news `_embeddingCache` cleared on every sync even when below threshold

**Location:** `smart-news.js:1577`

**Problem:** The cache is cleared when `_embeddingCache.size > 2000`, but this happens in the `finally` block of every sync. Since typical article counts are ~1,000, the cache is exactly at the threshold where it might be cleared after every sync, losing warm entries for the next cycle.

**Recommendation:** Raise the threshold to 5,000 (still only ~7.5 MB) or use an LRU eviction policy.

---

#### L-5: `stripHtml` in `script.js` creates a new `DOMParser` instance and parses up to 3 times per call

**Location:** `script.js:1489-1499`

**Problem:** The `stripHtml` method creates a new `DOMParser()` and calls `parseFromString()` up to 3 times in a loop to handle nested HTML entities. This is called frequently for rendering article titles and summaries.

```js
for (let pass = 0; pass < 3; pass++) {
    const doc = new DOMParser().parseFromString(text, 'text/html');
    const decoded = doc.body.textContent || '';
    if (decoded === text) break;
    text = decoded;
}
```

**Impact:** Each `DOMParser().parseFromString()` allocates a full Document object. For short strings (article titles), this is disproportionate overhead. Typically only 1 pass is needed, but the loop always allocates at least one Document.

**Recommendation:** Use a shared `textarea` element's `.innerHTML` trick for entity decoding, which is orders of magnitude cheaper than DOMParser.

---

## Not Yet Audited

The following areas remain for Phase 3 analysis:

- [ ] `index.html` — initial payload size, CSS/JS loading strategy, Alpine.js template complexity
- [ ] Individual `src/sources/*.js` handlers — deeper algorithmic analysis of remaining 23 handlers (VozSource and TuoitreSource spot-checked)
- [ ] Memory profiling under load — actual RSS/heap measurements during sync cycle via `/health` endpoint
- [ ] Concurrent user behavior — single-tenant assumption vs. reality
- [ ] Proxy cascade network efficiency — end-to-end latency measurement of the 6-strategy fallback chain
- [ ] `smart-news.js` `deterministicGroups` (lines 465-598) — pairwise similarity scoring between all articles within a category
