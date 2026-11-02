# Article reader modal investigation — 23 October 2026

**Status: focused correctness repairs verified; the requested consistently smooth desktop/iPhone result is not established. Do not deploy or call the stutter fixed from this draft.** The software-rendered desktop and dark/image cases still miss frame budgets. No production code was changed, no service was stopped/restarted, and no database edits or cache clearing were performed. The live UI smoke used normal GET requests with API mutations blocked; normal server caching may occur during those reads. The user chose to continue with the available browsers.

## Snapshot and reproduction

The development copy was made from the actual dirty production working tree, including the October 19 repair. An independently fetched GitHub main (`bce460c`) matched every touched runtime file. The original checkout and its staged/unstaged changes were preserved. PR #5's thumbnail admission, assigned-source retention, focus/palette and image-rendering implementations are untouched. Those fixes target feed cards and cannot address the reader's separate post replacement, touch-event ancestry, position persistence or restore anchoring.

A read-only browser session opened a real production Smart article through its card: the reader had 403 elements and 30 images, `scrollHeight=4751`, `clientHeight=814`, and no page errors. API mutations were blocked in that browser session. Private production HTML and its screenshot stay in the local evidence directory, outside the PR. The production article was an interface/architecture smoke check; the controlled performance measurements below use deterministic fixtures through the complete production reader, not a standalone scrolling page.

Chromium 149 and Linux WebKit 26.5 are available on Linux ARM64. Chromium reports SwiftShader and software graphics; this is not a hardware-accelerated MacBook or iPhone. Desktop cases use 1440×900 and mobile cases 390×900 at DPR 1. Chromium mobile rows use a touch-enabled mobile viewport with automated wheel input; they are not iPhone touch/momentum measurements. The observed best idle frame cadence is approximately 16.7ms. RAF intervals are main-thread scheduling observations, not presented GPU FPS. Clean samples, observer-instrumented samples and DevTools traces are separate. Early exploratory runs that overlapped another browser run are excluded from the final comparison.

## Actual scroll ownership and dependencies

`public/components/article/overlay.html` owns **`#overlay-scroll-container`**, a native `overflow-y:auto` flex child of `.article-overlay-panel`. It scrolls vertically with `touch-action:pan-y pinch-zoom`, `overscroll-behavior:contain`, and no JavaScript touch-scrolling implementation. The header is a sibling outside its scrollable content, with sticky styling. The document body is locked, and the separate feed `#scroll-container` switches to `overflow-hidden` while the reader is open.

```mermaid
flowchart TD
    Card[Production article card / deep link] --> Nav[article/navigation.js]
    Nav --> Open[article/overlay.js: openArticleOverlay]
    Open --> Cache[RAM article cache / request ownership]
    Cache --> Fetch[/api/article-content]
    Fetch --> Parse[articles/parser.js / readers.js]
    Parse --> Sanitize[post-markup cleaner / article-media.js]
    Sanitize --> Apply[applyOverlayArticleData]
    Cache --> Apply
    Apply --> Renderer[article/content-renderer.js]
    Renderer --> DOM[article-rendered-content]
    DOM --> Scroll[overlay-scroll-container: native scrolling]
    Scroll --> Position[sources/voz-scroll-position.js]
    Position --> Persist[app/persistence.js / preference-writes.js]
    Persist --> Storage[local checkpoint + serialized server preference]
    Apply --> Embeds[article/embeds.js / native image lazy loading / media]
    Embeds --> Layout[Decode, intrinsic sizes, layout and anchoring]
    Layout --> Scroll
    Background[VOZ current-page background refresh] --> Reconcile[sources/voz-post-reconcile.js]
    Reconcile --> DOM
    Feed[Feed refresh / card observers / sidebar and header glass] --> Composite[Shared page paint and compositor work]
    DOM --> Composite
    Close[Close / related navigation / pagehide / hidden / freeze] --> Position
    Close --> Cleanup[Reader session release, timer cancellation, state clearing]
```

The main click/open path cancels speculative prefetch, resolves saved VOZ page/permanent IDs, creates a request generation, locks the body, marks the source read, records recent reading, and checks RAM content before requesting extraction. A cache miss has a 400ms progress poll that stops when the request finishes. Sanitization/media normalization is server-side, followed by source-time formatting and HTML insertion on the client. The existing `articleContentCache` is bounded at 60 entries. Related navigation captures the reader snapshot and restores it when going back. Theme changes update the existing modal; window resize changes responsive state. Browser history/deep links remain in `article/navigation.js`.

The only declared scroll handler on the reader calls VOZ position tracking. Non-VOZ plain-text scrolling does not save progress, fetch related coverage, update the URL, or rebuild the content. The before trace shows that expensive plain-text intervals occur with **zero layout/style counts and no long tasks**. Feed scroll handlers belong to a different element and do not receive reader scroll events.

Other asynchronous work remains relevant: source times update every 30 seconds; cache state polls every 60 seconds; Smart briefing refresh and server events can update background cards; the reader's requested summary/audio/widget actions can update UI. Twitter hydration checks only embeds without a hydration state, polls widget readiness for at most 80 attempts, and uses connectivity checks. Native article images use `loading=lazy`, `decoding=async`, and keep their assigned source. Their lazy-loading is browser-owned, unlike PR #5's thumbnail observers rooted at the feed. No new image observer, paragraph virtualization, `content-visibility`, permanent transform or per-element GPU layer was added.

## Confirmed defects and repairs

1. **Unchanged VOZ refreshes destroyed every post.** The original current-page refresh cloned all posts and called `replaceChildren` even when the response matched. It then assigned serialized HTML to Alpine's `x-html`, potentially causing another full replacement. In the real modal's 120-post stress fixture, an unchanged response retained **0/120** post nodes and removed 120. The candidate retains **120/120**, removes none, and leaves the scroll offset unchanged. Initial replay duration, including a deliberate 100ms settlement wait, changed from 450.7ms to 132.7ms; this exploratory duration is not a clean scroll-speed benchmark.

   `voz-post-reconcile.js` owns keyed reconciliation. Unchanged post, image and iframe nodes survive, including runtime widget/spoiler state. Changed posts update individually; normal live deletions/order follow the server. Cache-board historical bodies and missing historical posts remain in their original sequence. Duplicate/unknown identities fail closed. Structural updates preserve a retained visible anchor; unchanged responses do not read geometry or mutate the DOM. `content-renderer.js` owns insertion and adopts reconciled markup before updating `overlayContent`, preserving export, speech, cached content and stack snapshots without a second HTML replacement. Both use weak ownership and add no observer or timer loop.

2. **Final VOZ position could be lost.** The old scroll handler scheduled a RAF and skipped sampling within 120ms. Closing canceled the pending RAF and only flushed already queued preferences. The new dedicated position module samples a final checkpoint before close, navigation, hidden/pagehide and freeze. Scroll callbacks only arm a trailing checkpoint (300ms quiet time, bounded at one second during continuous input); geometry and storage are outside those callbacks. Ordered post selection uses binary search. The permanent post ID, ordinal and actual current page remain distinct. Old request-generation timers cannot write into a replacement article. Frozen per-component ownership tokens coalesce across Alpine’s distinct evaluator proxies; direct proxy identity is not a reliable owner.

3. **Overlapping preference requests could arrive out of order.** Existing preference flushing could send concurrent values for the same key. The modular writer now serializes each key, drains the latest pending value, rejects stale local acknowledgments, and retains failed values for retry. This reduces unnecessary persistence work and protects position correctness; it is not presented as a desktop rendering fix. The local final checkpoint is synchronous. Cross-device transmission after abrupt browser/process termination remains best effort, especially if an older network request is still in flight.

4. **Back navigation could apply browser anchoring on top of a correct saved offset.** A browser regression recorded `snapshot.scrollTop=1200`, then `scrollTop=1078` after returning to the same VOZ geometry. The candidate temporarily disables anchoring across only that owned content replacement. It commits the saved offset once after Alpine’s visibility callbacks, then releases suppression after the rendering boundary. A premature nextTick write can otherwise clamp to zero while the old visibility state is still pending. Wheel, touch or keyboard input cancels a pending restore; transient listeners are removed on completion/cancellation. Normal reading stays native, and subsequent images retain native anchoring. The replay now restores **1200 → 1200**. Newer/closed sessions invalidate the restore. Existing speech initialization is also called when restoring an article so its control geometry is ready before positioning; the old implementation cleared its chunks and could remove its widget.

5. **Touch listeners unnecessarily blocked the reader ancestry.** CDP showed a non-passive `touchmove` listener on `.article-overlay-root`, a non-passive `touchstart` on its panel, and a non-passive `touchmove` on the scrollport. The active prevention is now on the backdrop sibling; the panel/scrollport propagation handlers are passive. Body locking and native overscroll containment remain. Synthesized touch gestures did not actually move the scrollport on this host, so their apparent 16.7ms intervals are rejected as scrolling evidence. No physical Safari responsiveness improvement is claimed from listener flags alone.

6. **Deferred insertion effects lacked request ownership.** The existing after-insertion callback hydrated media, reset `scrollTop`, restored VOZ position and released read-ahead without an initial generation check. `render-effects.js` now owns that exact extracted implementation and rejects closed/replaced/restored requests before touching the DOM. Focused regressions cover obsolete and current callbacks. This is an ownership correction; a connection to the original steady-scroll stutter is not established.

## Rendering investigation and acceptance boundary

Plain text reproduces stalling after load without image decode, persistence, content replacement, long tasks, layout or style recalculation. Removing only modal blur, shadows, sticky positioning, changing clipping/containment, promoting selected layers, and grouping surfaces did not reliably solve it. A diagnostic that hid the whole stationary main/sidebar behind the modal reduced one desktop sample substantially; hiding only the feed in a later mobile A/B/A did not help (18.5 → 18.9 → 19.1ms mean). Removing all background blur improves some software-rendered cases but changes the design. These are diagnostic comparisons, **not shipped changes** and not proof of an isolated hardware-GPU bottleneck. No containment, visibility, blur downgrade or GPU promotion was shipped.

The final clean comparison below still contains severe desktop/dark and image-case stalls. Improvements in post retention, final-position accuracy and refresh work do not establish consistently smooth steady scrolling. Several final single-sample means worsened; no consistent steady-scroll improvement is claimed. A diagnostic launch with `--disable-gpu` also remained slow (142.6ms light and 137.5ms dark desktop means); that exploratory control overlapped an isolated HTTP test and is excluded from the matched table. No browser launch flag is shipped. The remaining software-renderer cost is not fixed. Its reported draw-to-swap stage dominates the traced pipeline; the precise responsible rendering pass still needs further evidence. Do not attribute all of it to feed thumbnails, nor assume this server matches a physical Apple GPU.

All times below are milliseconds. Each row uses the same content, viewport, theme and 25 native wheel inputs. These are single sequential samples on an uncontrolled shared software-rendered host; they do not establish a reliable improvement. Every row has zero long tasks. The final candidate has worse means in several cases.

| Viewport / theme / fixture | Before mean / P95 / P99 | After mean / P95 / P99 | Before / after input-to-next-RAF P95 |
|---|---:|---:|---:|
| 1440:glass-light:plain | 42.3 / 100.0 / 150.0 | 47.1 / 100.1 / 133.3 | 127.5 / 98.6 |
| 390:glass-light:plain | 20.6 / 33.4 / 66.7 | 28.0 / 50.0 / 100.0 | 68.0 / 87.7 |
| 1440:glass:plain | 107.4 / 283.4 / 383.4 | 113.3 / 250.0 / 283.3 | 342.2 / 248.2 |
| 390:glass:images | 64.3 / 83.4 / 100.0 | 93.2 / 133.4 / 200.0 | 197.8 / 263.3 |
| 1440:glass-light:voz | 43.3 / 83.5 / 116.7 | 49.7 / 116.7 / 133.4 | 111.7 / 199.4 |
| 390:glass-light:voz | 21.7 / 50.0 / 50.0 | 27.6 / 50.0 / 50.0 | 65.8 / 76.6 |

Input timing is the wheel event timestamp to the first scroll-associated RAF callback. It includes automation/dispatch effects and is not input-to-presented-pixel latency. New contexts make these cold interface opens followed by a settled scroll phase; image-heavy scrolling still crosses lazy-loading boundaries. These first opens use the request-path fixture API, not a fresh network fetch from a publisher. Warm RAM reopens are measured separately below; completely warmed/decoded long-image scrolling remains unmeasured.


Separate warm RAM-cache plain-text scrolling (the exact URL is present in RAM and each reopened reader makes zero primary content requests):

| Viewport / theme | Before mean / P95 / P99 | After mean / P95 / P99 |
|---|---:|---:|
| 1440:glass-light:plain | 47.8 / 116.7 / 133.4 | 47.9 / 100.1 / 133.4 |
| 390:glass-light:plain | 30.0 / 50.0 / 83.3 | 23.3 / 50.0 / 50.0 |

These single samples also miss frame budgets and do not establish consistently smooth cached scrolling.

| Traced diagnostic metric | Desktop plain before → after | Mobile VOZ before → after |
|---|---:|---:|
| Script execution | 7.7 → 13.0 | 18.9 → 21.7 |
| Style recalculation | 0.0 → 0.0 | 0.4 → 0.0 |
| Layout | 0.0 → 0.0 | 0.6 → 0.0 |
| Paint aggregate | 7.8 → 12.4 | 13.0 → 21.5 |
| Layerize aggregate | 14.4 → 17.3 | 4.4 → 6.5 |
| RasterTask aggregate | 54.1 → 62.0 | 30.5 → 45.4 |
| Observer callbacks | 0.0 → 0.0 | 6.0 → 0.0 |
| Observer callback time | 0.0 → 0.0 | 2.0 → 0.0 |
| Reader geometry reads | 0.0 → 0.0 | 39.0 → 8.0 |
| Local storage writes | 0.0 → 0.0 | 6.0 → 1.0 |
| Reader attribute/child mutations | 0.0 → 0.0 | 0.0 → 0.0 |
| Reader nodes removed | 0.0 → 0.0 | 0.0 → 0.0 |

Trace categories overlap; their durations must not be added as total CPU or GPU time. Neither traced case records a Layout event with a JavaScript stack, and the desktop plain case records no layout/style work. This is a limited forced-layout observation, not proof that every code path is free of forced reflow. Both cases retain the first article node, clear zero image sources, and record zero scroll-interval layout-shift entries. Image-heavy clean samples perform six layout passes while lazy images settle; no image normalization or decode policy was changed. Precise image request/decode/display timing and GPU memory are not established by this data. Browser heap deltas are allocations/GC variation, not retained-memory savings.

Chromium's asynchronous compositor-stage events narrow the unresolved delay further. Matching each stage's begin/end ID gives the following **browser-reported draw-to-swap intervals** (milliseconds):

| Traced case | Before mean / P95 | After mean / P95 |
|---|---:|---:|
| Desktop light plain text | 77.3 / 81.3 | 96.8 / 113.4 |
| Mobile light VOZ | 25.7 / 29.3 | 34.6 / 45.5 |

Desktop submission-to-receipt and receipt-to-draw means are only 1.14ms and 0.55ms after the repair; draw-to-swap occupies 96.77ms of the reported 98.80ms submission-to-presentation interval. This locates the large traced delay after renderer submission. It does not isolate a CSS effect, distinguish drawing from waits within that stage, or measure physical display presentation. Pipeline intervals overlap across frames and must not be substituted for RAF cadence. The four matched GPU-process traces contain memory events but no detailed drawing passes. A subsequent capture enabled the missing Viz/Skia categories, described below. [Compositor-stage summaries](reader-modal-evidence/compositor-stages.json) are reproducible with `tools/experiments/reader-modal/trace-summary.mjs` against the four compressed traces.

A separate diagnostic after all tests completed enabled `viz`, `skia`, `disabled-by-default-gpu.service` and `disabled-by-default-skia` for 12 native wheel inputs. It identifies **Viz's software compositor**, even though WebGL renderer identification reports SwiftShader. `DirectRenderer::DrawFrame` took 117.68ms mean / 145.32ms P95 over 12 frames (1,412ms total wall time; 950ms reported thread time). Its software quad drawing occupied 1,390ms inclusive wall time, with 304 nested Skia `drawImage` calls occupying 992ms. Swapping buffers took only 0.333ms total. These nested inclusive values must not be added. Bitmap compositing is present even for a plain-text reader; `drawImage` here is not evidence of article-photo decoding. This capture narrows the server's remaining bottleneck to software drawing and filtered/composited bitmap passes. It does not establish which specific DOM/CSS surface causes the expensive pass or how a physical Apple GPU behaves. No application change is justified from a browser implementation name alone. The detailed capture is diagnostic, with extra tracing overhead, and is excluded from the clean before/after table. Its [summary](reader-modal-evidence/software-drawing.json) and [compressed trace](reader-modal-evidence/detailed-software-draw-trace.json.gz) accompany this draft.

The 120-post no-op refresh replay changes node retention from 0/120 to 120/120. Back-navigation correctness changes a saved 1200px position restored as 1078px into 1200px. These are confirmed component fixes; the frame tables do not support a claim of consistently smooth scrolling.

Sanitized fixture traces and screenshots are in [reader-modal-evidence](reader-modal-evidence/); the complete raw numerical report is [reader-modal-audit-2026-10-23.json](reader-modal-audit-2026-10-23.json). The six compared reader screenshot regions have **zero differing pixels** (desktop crop 860×900; mobile viewport 390×900). This verifies those settled states, not every transition, native video frame or physical-device presentation.

## Functionality, visuals and measurement limits

Maintained unit regressions exercise unchanged updates, individual edits/appends, widget identity, Cache-board history, deletion/reordering, duplicate identities, article clearing, final checkpoint capture, stale timer rejection, ordered writes/retry, and explicit restore ownership. Operational tests exercise all-hash preflight, backups, idempotence, unknown-change refusal, rollback refusal over later edits/corrupt backups, symlink refusal, subprocess-verification refusal and preservation of an application-data sentinel.

Browser assertions load the actual assembled application/modal with long text, slow/cached images, tables/code, iframe/video markup and a long VOZ thread. They check node/media identity through native wheel reversals and background feed revalidation, stack navigation, close/reopen, themes and desktop/mobile viewport sizes. Mobile WebKit uses programmatic offsets because its automation does not implement wheel input; this is functional comparative coverage, not native iPhone momentum evidence. The original harness also forced all CSS transitions off and reopened during the closing transition. That contaminated some early navigation results; final checks preserve native transitions and wait for closure. Those contaminated failures are excluded from product-regression conclusions. Page crashes and readiness failures remain documented separately.

The final isolated PR-tree suite ran **838 tests: 837 passed, one failed**, in **387.97 seconds**, with no skipped/cancelled tests. The unchanged Smart-feedback test with a 20ms request budget reached `queued()` without a queued function. Its isolated file rerun passed **9/9** in 9.19 seconds; both entry-point syntax checks then passed. This is a full-suite failure followed by a passing isolated rerun, **not a clean full-suite pass**. A preceding full run had an existing HTTP startup deadline failure (836/837), whose isolated rerun passed 1/1; the latest full run passed that HTTP test.

All **15 modal unit cases** and **five operational integration/rollback cases** passed. The fifth operational case verifies refusal when a child process is blocked or provides no completed-test summary, including an operating-system error accompanied by a zero status. The extracted render-effects ownership required aligning one existing source contract with its new module; the feed-policy assertions were preserved in a dedicated helper. The source/modal contract run passed **31/31**.

The new modal and safe-integration tests pass. The final integration bundle's `--verify` passed **71/71** targeted tests and **13 JavaScript syntax checks**. Its read-only production check recognized all **14 payload paths**. The three-minute (183.1-second) reader-open probe retained **385/385** content nodes with **zero content mutations, zero node/listener growth**, and its scroll position remained **1800px**. After diagnostic GC, browser heap used increased by 213,628 bytes; this short isolated probe is not a production retained-heap or GPU-memory acceptance test.

The complete final Chromium matrix passed **20/20** cases: five realistic content types × two themes × desktop/mobile viewports. Every case exercised wheel reversals, an open-reader feed refresh, related-article back navigation and three close/reopen cycles; VOZ cases also tested unchanged current-page refresh identity. All article/media identity and source-retention assertions passed, with no page errors. The additional existing control/deep-link helper passed **3/3** cases. Comparative Linux WebKit passed **4/4** selected cases; mobile WebKit used programmatic offsets. This is not exhaustive publisher or physical-device certification.

Durable saved post/page checkpoints are **VOZ-only** in the current application. Other articles preserve their offset within related-article stack navigation; fully closing and reopening those articles starts at the top, as before. General persistent progress for non-VOZ articles is not implemented by this repair.


Not covered by a passing result: hardware GPU presentation, physical iPhone/macOS Safari, human-driven inertia/keyboard/safe-area and dynamic viewport gestures, authenticated third-party social-widget internals, extreme megapixel decode memory, hours-long resource retention, reliable cross-device final upload after abrupt process termination, and exhaustive publisher HTML. Generated iframe/video fixtures do not stand in for every real third-party embed. A layout-shift API reporting zero in a scroll interval does not prove all image geometry is reserved. No speculative image size, decode, source or typography changes were made.

## Safe production integration and rollback

This is an **unmerged draft**. Applying it and restarting production require explicit authorization. The scripts never pull Git, delete data/caches, restart a service or merge a PR. Three adjacent modules in `ops/maintenance/reader-modal-{repair,bundle,payload}.mjs` contain the exact reviewed replacements and SHA-256 hashes. Their read-only compatibility check recognized the current production source. Every file must match its recorded before or after hash; unknown edits and symlinks refuse before writes. All originals and a manifest are backed up before the first change, each file is checked again before replacement, modes are preserved, and rerunning an applied bundle is a no-op. Rollback preflights all files and backups before restoring and refuses later edits.

From the reviewed bundle directory, a read-only check is:

```bash
READER_MODAL_BUNDLE=/absolute/path/to/reviewed/checkout/ops/maintenance/reader-modal-repair.mjs
node "$READER_MODAL_BUNDLE" --check /home/ubuntu/my-rss-reader
```

Run the full suite in the reviewed isolated checkout before the maintenance window. The current server caches its client-module list, so installation requires an approved service stop/start; applying while it is serving could mix old module registration with new templates. Only after explicit installation and service-activation approval:

```bash
sudo systemctl stop rss-reader
node "$READER_MODAL_BUNDLE" --apply /home/ubuntu/my-rss-reader
node "$READER_MODAL_BUNDLE" --verify /home/ubuntu/my-rss-reader
sudo systemctl start rss-reader
```

`--verify` checks the changed JavaScript syntax and targeted reader/navigation/preferences/assets regressions. The assembled client-module list is imported by the backend at startup: changing files is not activation. A coordinated restart is needed after an approved installation; avoid serving a half-installed/new-template and old-module-list combination. The script intentionally does not initiate that restart. On approved activation, verify `/health`, active/running state and restart count, startup logs and the assembled script's served hash. This task performed none of these production mutations.

`--apply` prints its unique backup directory. To roll back the exact installation (only after authorization):

```bash
node "$READER_MODAL_BUNDLE" --rollback /absolute/backup/directory/printed/by/apply
```

If installation or verification fails, keep the service stopped, restore the printed backup, and start the original version only after rollback succeeds. Plan the same approved stop/rollback/start sequence for a later rollback. Reader/database/cache data are outside the payload. Refusal over later edits is intentional; do not bypass it with a reset or overwrite.

## Reproduction

The browser diagnostics are modular files under `tools/experiments/reader-modal/`. They require an independently installed Playwright runtime, avoiding an application dependency change. Example on this host:

```bash
export READER_PLAYWRIGHT_MODULE=/tmp/rss-scroll-20261018/node_modules/playwright/index.mjs
export READER_WEBKIT_EXECUTABLE=/tmp/rss-webkit/webkit-2311/pw_run.sh
CASES=1440:glass-light:plain,390:glass-light:voz STEPS=25 node tools/experiments/reader-modal/run.mjs /tmp/reader-modal-clean
DIAGNOSTIC=1 TRACE=1 CASES=1440:glass-light:plain node tools/experiments/reader-modal/run.mjs /tmp/reader-modal-traced
node tools/experiments/reader-modal/regressions.mjs /tmp/reader-modal-regressions
ENGINE=webkit node tools/experiments/reader-modal/regressions.mjs /tmp/reader-modal-webkit
node tools/experiments/reader-modal/refresh-replay.mjs /tmp/reader-modal-refresh.json
npm test
```

Use a clean context for cold loading and explicitly repeat the open for warm RAM/HTTP paths. Run benchmark phases sequentially, after tests/other benchmark browsers finish. `VARIANTS` changes are temporary test-only CSS removed between cases; none enter production assets. Local raw evidence lives at `/tmp/rss-modal-20261023/evidence/`. Selected sanitized fixture traces, metrics and screenshots accompany this report; production content is excluded.
