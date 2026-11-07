# Cross-modal Graphite/Metal follow-up

**Outcome:** the requested fallback analyzer, gated diagnostic harness, Mac guide,
and results template are implemented. The affected Mac is not accessible from
this agent. No causal production repair has been selected or deployed.

## Facts and hypotheses

The supplied 772-frame recording contains exactly two reviewed multi-region
dropouts: source frame 77 at 1.461667 s, source duration 25 ms, return frame 78;
and frame 630 at 11.370000 s, source duration 8.333 ms, return frame 631. Both
also lack visible sidebar/header controls. Their interval is 9.908333 s.

Those pictures support the user's hypothesis that foreground content briefly
disappears and exposes the feed. They do not identify whether state/DOM, CSS
stacking, painting/compositing, or only the screen recorder caused the loss.
Linux lifecycle observations were not taken during either Mac event. Historic
mailbox errors and coincident 2 s / 5 s polls are not time-correlated proof.

The affected machine is an M5 Pro MacBook Pro, macOS 27.0.1, Chrome
157.0.8103.39, GraphiteDawnMetal, and a 120 Hz display. The only connected
Browser Bridge profile was rechecked in a dedicated temporary tab: Linux x86_64,
Chrome 156. The tab was closed. Permission to perform Mac experiments is present;
technical access to the affected environment is absent.

[Chromium issue 551970386](https://issues.chromium.org/issues/551970386) remains
a relevant lead with a different symptom and no demonstrated identification
with this application's defect. The shared sidebar/header glass, other backdrop
surfaces, and graphics/capture path require controlled on-device comparisons.

## Analyzer and evidence

Run [analyze-recording.mjs](../tools/experiments/modal-reliability/analyze-recording.mjs)
with one recording path. The supplied source is recognized by file fingerprint;
future modal/layout
recordings get a local region picker and explicit calibration instead of a
universal fixed mask. The analyzer verifies source PTS and decoded frame counts,
preserves VFR, separates packet duration from presentation span, reports exposure,
event intervals/rates, captured fps and duration distribution, and warns about
insufficient coverage. Invalid/corrupt media produces a failed status, not events.
Successful analyses require `status.json: complete`.

The original reanalysis has duration 13.878333 s, 55.626 captured fps, and a
58.334 ms maximum inter-frame gap. Source durations have median 16.667 ms,
p95 25 ms, and p99 33.333 ms. Its observed count is 2, or 8.647/min **only in
that short clip**; this is not extrapolated to a long-run baseline.

Annotated neighboring frames/contact sheet and JSON/Markdown evidence are in
`test/fixtures/generated/modal-reliability/original/` (generated, Git-ignored).
The old positive/negative frame-scoring fixtures remain. A test-only measurement
bug was corrected: Sharp reference crops now use `fit: fill` to match FFmpeg's
full-region resizing, rather than silently cropping the reference with `cover`.
Use fresh new-analyzer reports for future comparisons.

## Diagnostic scope and exact application changes

**Production HTML, CSS, JavaScript, API implementation and scheduling were not
changed.** No service restart occurred. Optional test-server wiring in
[server.js](../test/helpers/frontend-refactor/server.js) supports HTML injection,
a request hook and a loopback port; defaults retain fixture behavior.

[diagnostic-server.mjs](../tools/experiments/modal-reliability/diagnostic-server.mjs)
requires explicit `--enable`, binds loopback and checks Host/Origin. It injects
[diagnostic-mode.mjs](../tools/experiments/modal-reliability/diagnostic-mode.mjs)
only into that test origin. Fixture data is the default. Explicit `--live`
streams API/SSE traffic to a loopback backend and preserves normal action effects;
it is not a production deployment or a read-only clone.

Implemented primary switches: `nobgglass`, `nobackdrop`, `nomodalblur`,
`noai2poll`, `noprovider5poll`, `noactivity60poll`, and `nofeedpoll`. Initial
loads remain intact. Poll switches match both callback and interval; feed
suppression is narrowly identified as automatic client Smart refresh/apply paths,
not backend RSS processing. CSS verification checks visible elements, prefixed
filters and generated pseudo surfaces; a closed modal is not reported verified.

Bounded diagnostic records contain timing, real method callers/completions,
requests, state changes and surface mutations. Optional `observe=1` adds root,
panel, backdrop, ancestor/sidebar/header style/identity/foreground observations.
The manual mark also emits a named User Timing event for trace alignment. No
API bodies, key inputs, article bodies or screenshots enter the diagnostic ring.
Instrumentation can affect scheduling and must be compared separately.

## A/B/A and before/after results

No new Mac runs were executed. Baseline, Graphite off, shared-background glass,
global backdrop, 60 Hz and final-fix measurements remain **pending**, not zero.
[EXPERIMENTS.md](../tools/experiments/modal-reliability/EXPERIMENTS.md) provides
the numbered Mac sequence, configuration/recording names, capture checks,
SSH-forwarded test origin, restoration and trace instructions.
[RESULTS.md](../tools/experiments/modal-reliability/RESULTS.md) distinguishes
the original reference from missing comparable runs. The comparison command
weights counts by independent recorded exposure and refuses mixed layouts or
unknown final duration. No before/after repair efficacy is claimed.

## Validation

- The new analyzer returned exactly frames 77 and 630 from all 772 source frames;
  the annotated contact sheet was manually inspected.
- Unit/integration regressions cover VFR timing, return-frame presentation span,
  partial changes, persistent closing, missing duration, corrupt media, missing
  FFmpeg/ffprobe, region validation, crop resizing and exposure-weighted comparison.
- All seven switch modes plus diagnostic baseline passed isolated Chromium
  functionality checks. Initial data remained loaded; only the chosen recurrence
  was suppressed; background-only blur kept modal blur; manual feed loading and
  Escape/draft behavior remained usable. The live proxy was tested against a
  **dummy backend**, including rejecting cross-origin writes.
- A subsequent read-only check through the proxy against the running backend
  returned HTTP 200 for Smart status and the event stream, then disconnected.
  Login/write workflows on the affected Mac remain unverified.
- A further isolated check verified HTML pseudo-element filtering, AI/article
  layer observations, and clean reload to baseline with no injected style left.
- The full suite run had **956/957 passing**. The existing publication-retention
  subprocess exceeded its 25 s timeout after logging five expected retention
  cycles. Its isolated rerun passed in **11.0 s**, with no source change to that
  test. The full run is not relabeled clean. Focused tests were rerun after final
  tool refinements; these are tool regressions, not repeated Mac efficacy tests.
- Syntax, scoped whitespace and absent-production-wiring checks passed. The
  production service remained active/running with the same PID and zero restarts.

## Visual/performance boundary, deployment and rollback

Production appearance/performance has no implementation change to assess. The
diagnostic CSS ablations intentionally change filtering and are not proposed
Liquid Glass replacements. No Mac visual parity, frame-time, GPU-cost, physical
iPhone, A/B/A efficacy, or post-fix acceptance result is claimed.

No production fix or deployment exists to roll back. Stop the diagnostic process
and SSH tunnel and return to the normal URL to remove the experiment. Reload
without query switches restores native recurring timers; unpatching functions
without reload cannot revive a suppressed interval. Diagnostic code remains
confined to test tools and can be removed without production imports/routes.

The remaining evidence is three comparable 120-second Mac baselines, matched
controls with adequate capture coverage, and a time-correlated occurrence with
trace/DOM/poll/GPU data. After a mechanism is established, the acceptance plan
requires at least three comparable post-fix 120-second runs for each principal
modal, extended for rare events. A clean short run never proves zero future risk.
