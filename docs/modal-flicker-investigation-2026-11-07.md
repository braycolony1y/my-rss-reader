# Cross-modal flicker investigation — 7 November 2026

**Status: unresolved. No production flicker fix has been applied or deployed.**

## Confirmed evidence

Every one of the supplied recording's 772 frames was decoded without frame-rate
conversion. Fixed header, footer, and backdrop regions detect exactly two complete
overlay disappearances: frame 77 at 1.461667 s (25 ms source duration), and frame
630 at 11.370000 s (8.333 ms). Adjacent frames retain the modal. The dropout
frames also lack visible sidebar icons and feed-header controls; ordinary
modal-hidden browser screenshots retain those controls.

The affected system is the user's Apple M5 Pro MacBook Pro, macOS 27.0.1,
Chrome 157.0.8103.39, GraphiteDawnMetal, hardware compositing/rasterization, and
a 120 Hz display. Its GPU log includes historic missing-mailbox errors, but those
entries have not been correlated with either recording event.

## Ownership and causal limits

Both the AI usage root and article reader root are persistent body siblings under
the single Alpine `rssApp()` scope. Their visibility is controlled by explicit
open/close state. No recurring parent reinitialization or shell replacement was
found. The AI modal polls progress every 2 s, provider debug statistics every
5 s, and activity every 60 s; the first two coincide every 10 s. Coincidence is
not a demonstrated trigger.

Glass Light already disables backdrop filtering on the article reader panel and
backdrop. Therefore removing only the AI overlay's blur would not address the
reported cross-modal problem. Shared fixed background glass surfaces remain a
rendering lead. [Chromium issue 551970386](https://issues.chromium.org/issues/551970386)
describes a related Graphite overlay artifact, but its symptom differs and it
does not establish this application's cause.

The evidence favors investigating shared rendering/compositing. **Neither a DOM
failure, stacking failure, nor a specific compositor defect has been conclusively
identified during an occurrence on the affected machine.** A speculative shared
CSS or modal lifecycle change would not meet the requested causal acceptance.

## Changes made

Only investigation/test code changed. The existing modal fixture now delegates
to a focused fixture module serving the actual `/api/smart-status` and
`/api/summary/debug` endpoints. Previously those requests fell through to empty
responses, so the old harness did not exercise changing progress/provider data.

Focused modules now provide per-animation-frame shell observations, timestamped
application-call boundaries, changing feed/provider/activity fixtures, accelerated
polling and delayed-response stress, painted-frame region analysis, and a shared
surface sweep. The frame detector has regression coverage for an immediate
disappearance/reappearance and for partial changes that must not count as a
full-overlay loss. See the [harness instructions](../tools/experiments/modal-reliability/README.md).

## Completed verification

| Scenario | Actual result |
| --- | --- |
| AI usage, 65 s real intervals, no capture | 611 animation-frame observations; no unexpected visibility/state/removal/focus failures; live data, scroll, draft, button close/reopen, Escape passed |
| AI usage, corrected 65 s desktop capture | 69 captured frames over 65.67 s; no detected dropout; DOM/focus/scroll and activity refresh passed |
| AI usage, 390 px mobile emulation, accelerated | 114 captured frames over 12.38 s; no detected dropout; 59 provider revisions and five activity revisions; focus/draft/scroll and close/reopen/Escape passed |
| Article reader, settled 65 s scroll/refresh run | 80 animation-frame observations; no root mutations, removals, state changes, visibility failures, or page errors |
| Ten-shell shared sweep | No per-frame hiding, removals, unexpected state changes, or page errors |
| Cache history and feedback picker | Both additional shells passed with valid fixture state; no page errors or per-frame shell failures |
| Accelerated delayed/out-of-order responses | Two observed out-of-order method completions; 27 captured frames; no detected disappearance or shell/focus/scroll failure; live statistics/activity continued |
| Focused Node regressions | Frame analyzer, AI modal stability, and interaction lifecycle test files passed |
| Final control/identity check | 86 observed frames; original root identity retained across close/reopen; button, Escape, and outside-click dismissal passed; unsaved draft retained |
| Full `npm test` run | 946 of 947 tests passed; isolated HTTP application test exceeded its 30 s subprocess timeout during concurrent test/browser load |
| Isolated HTTP rerun | Passed in 10.4 s after the concurrent load finished; the original full-suite run remains recorded as 946/947 |

The server and feed-worker syntax checks also passed. The three focused test
files were rerun after the frame-detector changes and passed again.

The running HTML, composed script, and AI modal stylesheet were hash-verified
against the local source used by the fixture, with HTTP 200 for each. No restart
was needed because application code was not changed.

The preliminary desktop capture delivered one stale frame from the test's
deliberately hidden reference before measurement. It is **not** a reproduced
application flicker. The harness now flushes a restored paint before recording.
Likewise, preliminary article checks began before its slow opening animation
finished; the probe now waits for actual settled opacity/transition completion.

## Remaining acceptance boundary

These are baseline tests, not a comparable before/after production-fix result.
Desktop capture averaged approximately 1 fps, with a maximum gap of 1.88 s;
mobile capture averaged approximately 9 fps, with a maximum gap of 0.384 s.
Neither excludes an 8–25 ms dropout on the affected Mac. The server browser is
Chromium 149 using a different Linux graphics path. Patched Playwright WebKit
and Firefox are not installed; mobile checks are emulation, not a physical iPhone.

A time-correlated occurrence on the affected graphics backend is still needed
to establish the causal trigger and validate a visually preserving universal
repair. A short run without a rare event, including after a graphics flag change,
must not be treated as proof of elimination. Production behavior, polling,
appearance, data, and unrelated working-tree changes were left intact.

Evidence files are under `/tmp/ai-modal-video/` and `/tmp/ai-modal-usage/`.
The original test fixture was saved at
`/tmp/ai-modal-usage/original-modal-fixture.mjs` before its delegation change.
