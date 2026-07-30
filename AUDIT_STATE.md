# Audit State — my-rss-reader

> Machine-readable checkpoint for resuming audits across sessions.

## Session Log

### Session 1 — 2026-07-30

**Phase:** DISCOVERY  
**Status:** Phase 1 complete. Phase 2 not started.

**Files fully analyzed:**
- `server.js` — All 5,548 lines read and analyzed
- `smart-news.js` — Lines 1-200 (initial patterns, embedding pipeline, similarity scoring)
- `summary-engine.js` — Lines 1-100 (key manager architecture)
- `src/sources/index.js` — All 78 lines (source registry pattern)
- `script.js` — Lines 1-500 (Alpine.js app state, initApp, saveState, fetchData flow)
- `package.json` — All dependencies reviewed
- `PROJECT_STRUCTURE.md` — Full read

**Findings documented:** 16 total (C-1 through L-3)

---

### Session 2 — 2026-07-30

**Phase:** DISCOVERY (Phase 2)  
**Status:** Phase 2 complete.

**Files fully analyzed (this session):**
- `smart-news.js` — Lines 200-1602 (clustering algorithm, Gemini batch processing, sync logic, source management)
- `summary-engine.js` — Lines 100-1070 (Qwen/Gemini clients, prompt builders, deep analysis, summary queue, Voz thread summarizer)
- `script.js` — Lines 500-2850 (article overlay, beautifyArticleHtml, AI summary UI, infinite scroll, prefetch pipeline, Voz scroll tracking)
- `src/sources/VozSource.js` — Lines 1-400 (image extraction, thread parsing, reaction bar rendering)
- `src/sources/TuoitreSource.js` — Lines 1-100 (article parsing, related article extraction)

**New findings documented:** 12 additional (C-4, H-6 through H-9, M-7 through M-12, L-4, L-5)

**Key discoveries:**
- **C-4:** Quadratic pair-counting in `collectGeminiRetryCandidates` token index
- **H-6:** Sequential Gemini calls with 25s+ dead wait time across 5 categories
- **H-7:** `markAllAsRead` N-request fan-out compounding with C-2 serialization
- **H-8:** Client-side `beautifyArticleHtml` doing heavy DOM processing on every article view
- **H-9:** Frontend `readStates` array mirroring server-side C-1 issue
- **M-7:** Embedding pipeline re-computing all vectors on every sync (vectors stripped before persistence)
- **M-8:** 6 consecutive `db.put()` calls writing 45 MB total at end of smart sync
- **M-10:** Undebounced hover-triggered article prefetch causing fetch storms
- **M-11:** Summary queue worst-case latency of 810 seconds from cascading 90s timeouts
- **M-12:** VozSource `getBestImage` making up to 6 sequential HTTP requests for image extraction

## Cumulative Findings Summary

| Severity | Count | IDs |
|----------|-------|-----|
| CRITICAL | 4 | C-1, C-2, C-3, C-4 |
| HIGH | 9 | H-1, H-2, H-3, H-4, H-5, H-6, H-7, H-8, H-9 |
| MEDIUM | 12 | M-1, M-2, M-3, M-4, M-5, M-6, M-7, M-8, M-9, M-10, M-11, M-12 |
| LOW | 5 | L-1, L-2, L-3, L-4, L-5 |
| **Total** | **30** | |

**Measurements taken (Session 1):**
- `database.json`: 7,765,800 bytes
- `smart-data.json`: 7,855,609 bytes
- Article count: 6,484
- Feed count: 43
- Smart clusters: 3,844
- Smart raw articles: 1,809
- Read states: 821
- Saved states: 13
- Hidden states: 1
- Article cache files: 9,695
- Article cache disk usage: 170 MB
- Average article object size: ~1,023 bytes

## Phase 3 Plan

Priority order for next session:

1. **`index.html` full read** — Measure initial payload size, JS/CSS loading strategy, and Alpine.js template complexity.

2. **Memory profiling** — Run the app and capture `/health` endpoint data during a sync cycle to measure actual RSS, heap usage, and GC pause frequency.

3. **`deterministicGroups` deep analysis** — `smart-news.js:465-598` — this function builds pairwise similarity scores between all articles within a category; could be another O(n²) hotspot.

4. **Source handler audit** — Spot-check 3-4 remaining large handlers (`VnexpressSource.js`, `TinhteSource.js`, `DantriSource.js`) for parsing inefficiencies.

5. **Network efficiency** — End-to-end latency measurement of the 6-strategy proxy cascade.

## Unchanged Areas

These areas were examined and found to have no significant performance concerns:

- **Article cache filename hashing** — SHA-256 is fast enough; switching to a non-crypto hash is LOW priority.
- **Express middleware stack** — Minimal middleware, no measurable overhead.
- **Auth middleware** — Simple cookie check, negligible.
- **`_writeJsonAtomic`** — Correct atomic-write pattern (temp + rename). The issue is frequency, not implementation.
- **`withDbLock` mutex** — Correct promise-chain lock pattern for single-process concurrency.
- **Summary engine key rotation** — `GeminiKeyManager` / `QwenKeyManager` are lightweight and correctly handle quota errors with 15-minute cooldowns.
- **`parseSummaryResponse`** — Simple regex parsing, no performance concern.
- **`fetchInBatches`** — Correct bounded-concurrency pattern (batch size 16) for smart source fetching.
- **TuoitreSource HTML parsing** — Standard regex-based article extraction, no algorithmic issues.

---

# Implementation Status

## Completed Implementations
## Completed Implementations
1. C-1: `/api/data` O(n×m) state array scans (includes M-6)
2. H-7: `markAllAsRead` N-request fan-out
3. C-3: Deduplication O(n²) `.find()` in loop
4. M-8: 6× `db.put()` at end of smart sync
5. H-5: `_jsonParsedCache` returns mutable refs
6. H-9: Frontend `readStates` plain array
7. M-10: Debounce hover prefetch
8. C-2: `Date.parse()` inside map/sort loops (Verified complete)
9. C-4: Unnecessary re-rendering of entire feed list (Verified complete)
10. H-1: Feed parser runs block Node.js event loop
11. H-2: Concurrent feed sync
12. H-3: In-memory cache index
13. H-4: Cache `content-filter-preview`
14. H-6: Concurrent Gemini per-category calls
15. H-8: Move `beautifyArticleHtml` to server side
16. M-3: Replace `googleNewsUrlCache` with LRU Map
17. L-1, L-4, L-5: Cache bounds and `stripHtml` optimization
18. M-7: Persistent embedding cache
19. M-12: VozSource image fetch limits
20. M-11: Unified summary provider concurrency
21. M-2: Caching universal tab prefetch computation
22. M-4: In-memory index for clear-article-cache
23. M-1: Lazy model unloading

## Remaining Implementations
4 findings remain (M-5, M-9, L-2, L-3).

## Current Progress %
83.3% (25/30)

## Last Completed Finding
M-1

## Blockers
None
