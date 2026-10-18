# Scrolling, image stability, and thumbnail audit — 19 October 2026

**Status: verified fixes for specific loading and rendering-state defects; overall acceptance remains open.** Production was not modified, restarted, or deployed. PR #5 remains the delivery vehicle: https://github.com/braycolony1y/my-rss-reader/pull/5.

Desktop frame times remain unacceptable in this VPS's software renderer. A whole-card compositor flash matching the original report has not been reproduced. Physical iPhone Safari and desktop Safari were unavailable. These limitations prevent a claim that the complete user-visible problem is resolved.

## Evidence and root causes

### Delayed thumbnails: confirmed ineffective preload margins

Both thumbnail observers used the browser viewport as their implicit root, while their targets were clipped by the nested `#scroll-container`. Expanding the viewport's root margin did not expand that intervening scrollport. The focus observer had the same defect.

A native-browser reproduction put a card at y=1400 in a 700px-high nested scrollport, with a 1200px preload margin. Chromium and WebKit both reported **not intersecting** with the original viewport root, and **intersecting** with the scrollport as root. This explains why PR #5's 400px → 1200px change could leave requests starting only when a card became visible.

The fix assigns the existing scrollport to the existing observers. It adds no observer or competing image queue.

### Image resets and flashing: confirmed destructive state transitions

The existing visible-request preemption removed another image's `src`, marked it unstarted, and restarted its lifecycle when it returned. Separately, the photo renderer removed the soft photograph's source when it left the focus region, including an already decoded surface. The old test explicitly required this offscreen unloading. A queued image with no `src` could also be classified as a failed image because `complete` is true and `naturalWidth` is zero, activating image-hiding CSS before any request had failed.

The fix keeps assigned primary sources through reversals, retains an already assigned soft surface for the same source, and distinguishes an unassigned thumbnail from a failed request. Never-viewed offscreen soft assets remain gated. Existing source-generation checks continue to reject stale metadata and decodes.

In separate read-only live Forum browser sessions, 15/15 original card nodes remained connected at the end in both variants. Production recorded five primary-source removals during the reversal sequence; the candidate recorded zero. Soft-source removals were eight versus one; the remaining candidate removal was not conclusively attributed and is not claimed eliminated. These live sessions had different cache/backend conditions and are **not** matched latency benchmarks.

The supplied 48.06-second, approximately 60fps iPhone recording was reviewed using a full-duration contact sheet, a 10fps detailed segment, and native consecutive-frame bursts around 43.0 and 43.6 seconds. It clearly contains blank image regions and late appearances. Closer native-frame inspection showed that part of the road photograph's apparent disappearance is ordinary viewport clipping. That sequence is excluded as proof of a compositor flash. The video does not reveal DOM identities, source mutations, input timestamps, or the device's display refresh rate. No stale pixels from a different article or whole-card disappearance were established from the inspected bursts.

### Scrolling work: confirmed unnecessary invalidations and layout work

Diagnostic callbacks located substantial work in the image-focus mutation/resize/intersection pipeline and hero-extent callbacks, outside PR #5's mobile dirty-card optimization. The renderer repeatedly assigned unchanged presentation attributes. Bottom-edge rendering deleted and restored its ready flag around layout reads. The focus observer requested old attribute values for large generated inline styles even though it subsequently ignored those owned style writes.

The fix makes presentation flags idempotent, retains valid bottom-edge state during recalculation, ignores owned photo/card styles before reading them, and deduplicates relevant attribute values in a per-installation WeakMap. The observer no longer requests copies of old inline styles. Leaving the proximity region updates eligibility without repainting the photo; entering still refreshes presentation and metadata as needed.

This reduces measured script/style/layout work. It does not establish the owner of all remaining raster/compositor stalls. No CSS effect was disabled, no permanent layer promotion was added, and no new animation-frame scheduler was introduced.

### Server interference: confirmed duplicate cold lookup

Forum thumbnail URLs include `rss=`. `/api/og-image` passed that absent fallback as `''`, while `/api/image-focus` passed `null`. `createArticleImages()` used the unnormalized fallback in its pending-work key, so concurrent requests for the same article could perform two full extractions. A controlled reproduction counted two extraction calls before and one afterward. A regression invokes both actual route handlers concurrently and verifies sharing.

The fix normalizes only an empty fallback before building the existing pending key. Different valid fallbacks stay distinct; errors still release pending work and allow retry. Source strategy order, article caches, image freshness, and inference behavior are preserved. This is an extraction-count improvement, not proof of a production latency or whole-service CPU reduction.

## Why PR #5 and its green tests were insufficient

- A larger margin on the wrong observer root did not provide the intended nested-scroll preloading.
- Visible preemption still cleared a source, and decoded soft layers still unloaded on proximity exit. Existing tests encoded that unloading behavior.
- Reducing mobile layout scans did not remove desktop focus/hero work, repeated attribute invalidations, or old-style copying.
- Client request limits did not coalesce the image and focus endpoints' differing empty-fallback keys.
- Unit tests did not measure actual paint presentation, hardware compositor behavior, or the original iPhone symptom.

The suspected remaining focus-opacity rule was inspected but not changed: the tested active card adapters override it. Network delay is real in some observations, but is not used as a universal explanation for flashing.

## Observer and update dependency map

| Trigger / owner | Work and scope | Layout / rendering interaction |
|---|---|---|
| Feed scroll → `ReaderFeedPagination.handleScroll` | Reads scroll position/height and requests the next page near the boundary | Appending real new cards initializes their existing owners; unchanged cards keep their object keys |
| Smart viewport → `viewport-priority.js` | Debounced 80ms visibility scan; 5s heartbeat; at most eight promoted IDs | Reads mounted Smart card rectangles; does not refetch `/api/data` |
| `thumbnail-loading.js` | Two existing intersection observers, one mutation observer, load/error capture | Card-owned eligibility works even if the source image is hidden; source assignment wakes focus handling |
| `image-focus.js` | Existing proximity, resize, and mutation observers; load; window resize; focus responses | Calls fit/placement/color routines; source generation owns focus/palette/tint/blend |
| `image-focus-mutations.js` | Scopes real source/content changes to affected cards; releases disconnected states | Ignores owned photo/card styles; no retained old inline-style copies |
| `blend/runtime.js` → hero extent → bottom-edge color | Resolves geometry and presentation for the affected photo | Contains synchronous geometry reads and style writes; unchanged flags no longer invalidate repeatedly |
| `mobile-top-layout.js` → `mobile-photo-framing.js` | Existing dirty-card frame, card/metadata/coverage resize observations, theme/media changes | Still owns mobile mask/framing/rail measurements; no redesign or new scheduler |
| Shared-card adapter | Chooses existing desktop/mobile light presentation | Preserves common final placement and restores properties when leaving that presentation |
| Smart/feed revalidation, SSE, background polling | Existing reconciliation and request-generation guards | Browser refresh replay verifies real DOM identity; this follow-up does not rewrite reconciliation |
| Bootstrap timers / visibility / reading lease | Source-time updates, cache/status polling, focus lease, persistence | Inspected as non-scroll triggers; no new global timer or listener system introduced |

## Performance measurements

Numbers below are observations, not hardware-browser acceptance. The environment was Node 24.20.0, Linux ARM64 VPS, Playwright Chromium 149.0.7827.0, DPR 1, 24 production-component fixture cards, native same-origin HTTP image responses, 50ms image and 20ms metadata fixture delays. Scroll movement went down 7000px where available and reversed, with a nominal six-second duration. Trace and observer instrumentation were disabled for the clean runs. Delays from a late callback can extend a run beyond six seconds.

The browser reported SwiftShader and `gpu_compositing=disabled_software`, `rasterization=disabled_software`. There was no physical display refresh measurement. Strict >16.7ms counts include clock rounding; raw data also includes a >17.2ms count. Percentiles use nearest rank. `rAF/s` measures callback cadence, not compositor-presented FPS. Desktop percentile samples are particularly small and variable.

All pairs are **before → after**:

| Case | Mean ms | P95 ms | P99 ms | rAF/s | Frames >16.7 ms | Frames >33.3 ms | Frames >50 ms | Long tasks | JS ms | Style ms | Layout ms |
|---|---:|---:|---:|---:|---|---|---|---:|---:|---:|---:|
| 1440:glass-light:top | 479.7 → 283.3 | 1250.0 → 350.0 | 1250.0 → 383.3 | 2.1 → 3.5 | 13/14 → 21/22 | 12/14 → 21/22 | 12/14 → 20/22 | 16 → 7 | 1028.9 → 433.3 | 1767.3 → 458.0 | 64.1 → 29.5 |
| 390:glass-light:top | 26.9 → 23.4 | 50.1 → 33.4 | 83.3 → 50.0 | 37.2 → 42.7 | 137/224 → 134/257 | 72/224 → 79/257 | 13/224 → 2/257 | 5 → 0 | 374.0 → 237.7 | 721.1 → 233.8 | 35.0 → 16.9 |
| 1440:glass-light:feed | 491.0 → 101.4 | 999.9 → 133.3 | 999.9 → 216.7 | 2.0 → 9.9 | 12/13 → 56/60 | 10/13 → 56/60 | 10/13 → 56/60 | 21 → 0 | 909.1 → 167.9 | 2222.2 → 169.8 | 139.3 → 20.6 |
| 390:glass-light:feed | 22.1 → 17.3 | 50.0 → 16.8 | 83.4 → 33.4 | 45.2 → 57.8 | 137/272 → 84/348 | 41/272 → 8/348 | 9/272 → 0/348 | 0 → 0 | 479.9 → 283.7 | 496.5 → 174.4 | 34.7 → 19.4 |

The mobile normal-feed run improved, but desktop results remain far outside a normal frame budget. Raw late-frame counts can increase when many shorter frames replace a few very long stalls; denominators are shown to avoid hiding that result. A separate traced desktop run worsened in mean interval, **239.2 → 305.9ms**, despite lower script/style costs. A cached desktop run also worsened, **255.2 → 268.7ms**. Consequently desktop smoothness is not accepted.

Representative requested metrics:

| Metric | Before | After | Change / interpretation | Environment |
|---|---:|---:|---|---|
| Mean frame interval | 22.1ms | 17.3ms | 21.8% lower | Clean mobile normal-feed run above |
| P95 interval | 50.0ms | 16.8ms | 66.4% lower | Same |
| P99 interval | 83.4ms | 33.4ms | 60.0% lower | Same |
| Strict >16.7ms intervals | 137/272 | 84/348 | 50.4% → 24.1%; includes rounding | Same |
| Long tasks | 0 | 0 | No change | Same |
| Main-thread script time | 479.9ms | 283.7ms | 40.9% lower | Same |
| Layout time | 34.7ms | 19.4ms | 44.1% lower | Same |
| Paint event time | 64.8ms | 51.1ms | 21.1% lower; not GPU presentation time | Separate four-second mobile diagnostic trace |
| Visible-image admission delay | 725ms | 1.4ms | First new visible request passes two slow preloads | Controlled native HTTP/1 fixture |
| Image load-event delay from visibility | 1646ms | 912ms | Includes a deliberately fixed 900ms response | Same; **not a painted-visibility measurement** |
| Actual thumbnail-painted delay | Unmeasured | Unmeasured | No compositor presentation timestamps; no zero-latency claim | Pixel endpoints were checked separately |
| Image requests during cached scroll | 0 | 0 | Browser HTTP caching preserved | Warm-byte four-second replay, both sampled viewports |
| Post-GC heap after ten refreshes | 13.05MiB | 13.15MiB | +0.10MiB in this bounded fixture; not a memory-saving claim | Disposable mobile Chromium, 12 cards |
| DOM nodes, refreshes 5 → 10 | 23335 → 23335 | 23341 → 23341 | No growth in either observation window | Same |
| Native listeners, refreshes 5 → 10 | 675 → 675 | 677 → 677 | No growth in either observation window | Same |
| Primary source removals during live reversals | 5 | 0 | Separate live contexts; not proof of original compositor cause | Actual 15-card Forum feed |

Separate diagnostic trace paint totals were **38.0 → 28.8ms** on desktop and **64.8 → 51.1ms** on mobile. Desktop `UpdateLayoutTree` totals were **706.7 → 386.7ms**; mobile **311.2 → 172.8ms**. These are aggregate trace-event durations and must not be combined with clean-run timings. Raster-worker/GPU presentation time and decoded-image/compositor memory were not measured.

The cached runs made zero new server image requests during scrolling in both versions. Their mobile mean/P95/P99 intervals were **33.8/66.7/100.0 → 19.3/33.4/50.0ms**. Cached bytes alone therefore did not remove all prior rendering work.

### Request-limit experiment

Two image responses were already in flight; two focus-like requests occupied connections; two new images became visible. Responses intentionally took 900ms. The existing loader consumed a policy with limits of two, three, and four for visible work. Preload concurrency stayed at two.

| Visible limit | Peak image requests | First newly visible image load | Navigation fetch | Existing sources retained |
|---|---:|---:|---:|---|
| 2 | 2 | 1646ms | 12.5ms | Yes |
| 3 | 3 | 912ms | 7.9ms | Yes |
| 4 | 4 | 942ms | 665.7ms | Yes |

The shipped policy retains two preload slots and permits one additional visible request, with a maximum of three expensive `/api/og-image` requests. Direct image URLs retain native loading. It avoids destructive preemption and preserves navigation headroom in this HTTP/1 test. It does not promise that every visible request starts immediately when all three slots are occupied. Production HTTP/2/3 and different upstream conditions can behave differently.

### Production backend observations

Three actual Forum image lookups were sampled twice, without following redirects: **1074.9/514.9ms (301), 79.8/28.4ms (301), 1461.9/1058.5ms (404)**. Successful lookups advertised `private, max-age=86400, stale-while-revalidate=604800`; the unsuccessful lookup did not. These are first-observed/repeated requests, not established cold/warm-cache measurements. No cache-hit marker exposed the internal lookup stage. Cache lookup, origin extraction, and upstream transfer were not independently timed in production.

Production was doing background work. An early resource sample reported event-loop P95 22.2ms and a 750.3ms maximum; no causal attribution to thumbnails was established. Neither the new server change nor any CPU/RAM benefit has been activated in production.

## Validation and acceptance boundaries

- **Actual-production source snapshot: 820 passed, zero failed, zero skipped**, including syntax checks. The initial run had snapshot setup failures, a loaded HTTP-test timeout, and the old offscreen-unloading assertion. Setup was corrected, HTTP passed alone, the assertion now tests gated first loading plus retained decoded surfaces, and the complete suite was rerun successfully.
- **Exact PR checkout full suite:** **811 passed, zero failed, zero skipped**, including syntax checks. Production and GitHub contain unrelated source differences; those changes were preserved instead of copying the whole production tree into the PR.
- Real Chromium and Linux WebKit regression: preload before viewport entry, ongoing-source retention, bounded visible admission, decoded-source stability through four reversals; no page errors.
- Chromium production-component interaction matrix: **six responsive/theme cases** (390/1440px × Classic/Liquid Glass dark/Liquid Glass light), including initial fetching, sidebar, Smart navigation, publisher widgets, overlay controls, refresh, deep links, and authentication.
- Chromium background-refresh replay: Top and normal feeds in Classic and light themes retained **8/8 cards**, with **zero card removals/insertions** and no page errors.
- Mobile Linux WebKit rendered light Top/normal feeds and Classic. An initial dark-theme case crashed; fresh baseline and candidate dark runs both completed with severe stalls. This is not Safari or hardware-compositor acceptance.
- The actual live Forum's settled returned viewport was **byte-identical** before and after the browser-only source override: SHA-256 `97b85640ad486048fff6f0e99d7fd34f2de49a888ceeecc41afe9078d652b7f9`. This proves one endpoint's visual equality, not every frame or mode.
- A 12-card candidate page retained the same nodes, DOM count, and listener count during the three-minute idle/polling observation: 23341 nodes, 677 listeners, 12/12 retained cards, post-GC heap 13.23 MiB after 180.2s. This does not establish hour-long retention or decoded/GPU memory bounds.
- Safe integration/rollback tests cover preflight conflicts, idempotence, unchanged user-data sentinels, restoration of original bytes, removal of only newly added repair files, and refusal to overwrite later edits.

**Unavailable / unproven:** desktop Google Chrome with a hardware compositor; desktop Safari; physical iPhone Safari after the change; the original whole-card flash; long real-feed/infinite-scroll sessions; actual compositor presentation latency; GPU layer/memory lifetime; detached-node retaining graphs; matched production CPU/I/O; and permanent long-session/OOM acceptance. No global GPU-layer workaround or visual redesign is proposed to conceal these gaps.

## Changed application modules

| File | Change |
|---|---|
| `public/thumbnail-admission.js` | Pure expensive-lookup policy consumed by the existing loader: two preloads, one visible reserve |
| `public/thumbnail-loading.js` | Correct observer roots; consume policy; retain ongoing sources |
| `public/image-focus.js` | Correct proximity root; ignore exit repaint; per-owner weak mutation values; versioned imports |
| `public/image-focus-mutations.js` | Filter owned writes early and deduplicate relevant attributes without old-style copies |
| `public/top-story-card/blend/runtime.js` | Retain same-source soft assets; distinguish queued/missing; idempotent flags |
| `public/top-story-card/edge-colors.js` | Keep an already valid ready flag while updating its presentation |
| `public/top-story-card/hero-extent.js` | Versioned import wiring only |
| `src/articles/images.js` | Share absent-fallback lookup work across image/focus endpoints |
| `index.html` | Image entry asset version only |

No CSS, card markup, text, typography, approved focal geometry, source strategy ordering, ranking, ingestion, or article-extraction policy was changed by this follow-up. New policy, probes, and integration logic are modules. Unrelated legacy code remains in place.

New/extended regressions: `thumbnail-admission`, `thumbnail-loading`, `thumbnail-lookup-sharing`, `image-focus-mutations`, `story-presentation-stability`, `top-story-blend-runtime`, `scroll-repair-integration`, and `helpers/thumbnail-viewport-browser.mjs`.

## Reproduce the checks

Use isolated source copies for BEFORE and AFTER, including the actual production modules and untracked source dependencies. Do not benchmark a clean GitHub main as though it were production. Supply Playwright and matching browser binaries in the isolated environment; do not install or rebuild dependencies in the running checkout.

```bash
npm test
node test/helpers/thumbnail-viewport-browser.mjs
READER_BROWSER=webkit node test/helpers/thumbnail-viewport-browser.mjs
node tools/experiments/scrolling-audit/preload-root-proof.mjs /tmp/preload-root.json
node tools/experiments/scrolling-audit/queue-limits.mjs "$AFTER/public" /tmp/queue-limits.json
node tools/experiments/scrolling-audit/run.mjs "$BEFORE" /tmp/scroll-before
node tools/experiments/scrolling-audit/run.mjs "$AFTER" /tmp/scroll-after
WARM=1 node tools/experiments/scrolling-audit/run.mjs "$AFTER" /tmp/scroll-cached
TRACE=1 node tools/experiments/scrolling-audit/run.mjs "$AFTER" /tmp/scroll-traced
DWELL_MS=180000 node tools/experiments/scrolling-audit/retention.mjs "$AFTER" /tmp/retention.json
```

`CASES`, `CARDS`, `DURATION`, `DISTANCE`, `IMAGE_DELAY`, `FOCUS_DELAY`, and `ENGINE` select controlled experiments. Use `WEBKIT_EXECUTABLE` when its binary is outside the default cache, plus platform library paths if required. Keep clean timing runs separate from instrumentation, video decoding, test workers, and trace recording. Raw source-removal evidence and recordings were retained locally; private recordings and production data are not included in the PR. The accompanying JSON contains measurement summaries.

## Safe production integration and rollback

**Do not deploy this draft as a claim that comprehensive acceptance is complete. Deployment requires explicit authorization.** The existing production files have local changes and a different Git base. No `git pull`, reset, clean, cache deletion, database replacement, or automatic restart is involved.

The self-contained `ops/maintenance/apply-scroll-repair.mjs` embeds only the nine required source-file preimages, replacement bytes, and hashes. It checks all files before any edit, accepts already-applied files, refuses unknown local edits/symlinks, saves originals and a rollback manifest under `ops/backups/`, and replaces each source file atomically. It never modifies application data or starts/stops the service. A dry run against the actual production checkout recognized all nine source files.

From a separate reviewed PR checkout, inspect without changing production:

```bash
node ops/maintenance/apply-scroll-repair.mjs --check /home/ubuntu/my-rss-reader
```

Only after deployment is explicitly authorized and the reviewed candidate checks pass:

```bash
node ops/maintenance/apply-scroll-repair.mjs --apply /home/ubuntu/my-rss-reader
```

Record the printed backup path. Frontend changes become available on reload; the server lookup-sharing change requires a separately authorized service restart. After authorized activation, verify `/health`, systemd `ActiveState`, `SubState`, PID and restart count, startup logs, and public/locally served asset hashes. Repeat browser/device acceptance; a healthy restarted PID is not performance proof.

Rollback refuses to overwrite any source edited after integration:

```bash
node ops/maintenance/apply-scroll-repair.mjs --rollback /absolute/printed/backup/path
```

If the backend change had been activated, an authorized restart is also required to activate restored backend code. Reload clients and repeat health/asset checks. Backups remain available; article databases and caches stay in place.
