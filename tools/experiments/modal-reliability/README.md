# Modal rendering regression harness

These tools exercise the assembled production Alpine templates against isolated,
changing fixture APIs. They never call billed providers or mutate production data.
They are investigation/regression tools, not a production flicker repair.

Run from the repository root with Node and Playwright installed:

```sh
node tools/experiments/modal-reliability/usage-run.mjs
USAGE_CAPTURE=0 node tools/experiments/modal-reliability/usage-run.mjs
USAGE_WIDTH=390 USAGE_SECONDS=12 USAGE_ACCELERATED=1 node tools/experiments/modal-reliability/usage-run.mjs
USAGE_WIDTH=390 USAGE_SECONDS=12 USAGE_ACCELERATED=1 USAGE_RACES=1 node tools/experiments/modal-reliability/usage-run.mjs
node tools/experiments/modal-reliability/surfaces-run.mjs
SURFACE_ONLY=article SURFACE_SECONDS=65 node tools/experiments/modal-reliability/surfaces-run.mjs
node --test test/ai-status-frame-analysis.test.js test/ai-status-modal-stability.test.js test/interaction-lifecycle.test.js
```

`USAGE_OUTPUT` and `SURFACE_OUTPUT` select output folders (default `/tmp`).
`PLAYWRIGHT_MODULE` can specify an installed Playwright module's absolute path.
`USAGE_ENGINE=webkit` or `firefox` requires the corresponding installed browser.
Only Chromium supports the CDP painted-frame capture in this runner.
`USAGE_NO_BLUR=1` is a diagnostic ablation affecting the test page only, not a fix.

The normal usage run preserves the actual 2 s / 5 s / 60 s polling intervals and
lasts 65 s. Acceleration divides those timers by 20 in the isolated page only.
Race mode snapshots responses before alternating delayed/fast delivery. The
workload includes slow scrolling, fast reversals, a stationary final third, and
background feed refreshes. Opening, button closing, reopening, and Escape use
the existing interface; drafts, focus, and scroll position are checked.

The shared surface sweep covers the article reader, add feed, content filter,
Smart sources, edit source, system monitor, boards, article debug, cache rules,
cache history, feedback picker, and legacy providers. AI usage is covered by the
dedicated runner. Most surface setup uses state flags deliberately: this sweep
checks shell rendering invariants, not the complete business flow of each modal.

Reports contain timestamped method starts/completions, DOM mutations/removals,
per-animation-frame visibility/focus/foreground observations, and layer counts.
Usage capture saves every delivered CDP frame and its timestamp. It does **not**
invent 60 fps frames. Inspect actual cadence/gaps before interpreting a clean run;
software rendering on a busy server cannot exclude a 120 Hz Mac dropout.

The frame analyzer compares header, footer, and backdrop regions with visible
and intentionally absent references. Those references are captured before the
probe starts, and a restored paint is flushed before screencasting. Its pixel
heuristic is regression support, not a guarantee against every possible paint
artifact or a substitute for a trace of the affected graphics backend.

Analyze a recording with source frame sequence, timestamps, durations, capture
coverage, and annotated evidence:

```sh
node tools/experiments/modal-reliability/analyze-recording.mjs recording.mp4
```

The supplied recording has a reviewed automatic profile. Other layouts generate
a local region picker and require their own calibration. See
[EXPERIMENTS.md](EXPERIMENTS.md) for the Mac A/B/A sequence, capture checks,
configuration files, restoration steps, trace correlation, and aggregation.
[RESULTS.md](RESULTS.md) distinguishes unavailable Mac results from zero events.
The earlier four-argument `video-analyze.mjs` remains available for compatibility.

Development-only switches require a separate process, explicitly enabled:

```sh
node tools/experiments/modal-reliability/diagnostic-server.mjs --enable --port 4317
node tools/experiments/modal-reliability/diagnostic-smoke.mjs
```

The default uses fixture data. `--live http://127.0.0.1:3000` explicitly forwards
normal API traffic to the existing backend; normal app actions retain their
normal effects. No production file, script URL, or service restart is required.
Queries on the normal production origin do not enable these diagnostics. Stop
the process and return to production to remove the mode completely.

The prior `run.mjs` remains available; its fixture now shares the corrected
`/api/smart-status`, `/api/summary/debug`, and activity contracts. A fixed number
of its wheel steps should not be described as a 60-second polling test.
