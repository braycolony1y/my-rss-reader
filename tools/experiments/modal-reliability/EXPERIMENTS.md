# Mac cross-modal flicker experiments

**No production repair has been established.** The available agent connection is
Linux x86_64 Chrome 156; its temporary identification tab was closed. It cannot
run or validate the M5 Pro / macOS 27.0.1 / Chrome 157 GraphiteDawnMetal path.
These steps prepare the missing on-device evidence without requiring the rare
event to occur during a short test.

## 1. Keep a run record and establish capture coverage

On the affected Mac:

```sh
mkdir -p "$HOME/Movies/rss-flicker-20261107"
system_profiler SPHardwareDataType > "$HOME/Movies/rss-flicker-20261107/hardware.txt"
sw_vers > "$HOME/Movies/rss-flicker-20261107/macos.txt"
defaults read '/Applications/Google Chrome.app/Contents/Info' CFBundleShortVersionString > "$HOME/Movies/rss-flicker-20261107/chrome-version.txt"
```

Open `chrome://gpu`, use **Copy Report to Clipboard**, then:

```sh
pbpaste > "$HOME/Movies/rss-flicker-20261107/gpu-baseline.txt"
```

Confirm GraphiteDawnMetal and hardware compositing/rasterization in that report.
Keep the existing Chrome profile, window size, zoom, display scale and 120 Hz
refresh, extensions, power state, external displays, and other foreground apps
the same. Close other reader tabs consistently. Record all settings in a text
note beside each video; note the modal, route, origin, visible card count, and
whether diagnostic instrumentation is enabled.
Finish or copy unsaved work before URL reloads or Chrome relaunches; those
deliberate setup operations start a fresh page.

Initially use the **same recording app and settings as the original recording**.
The file does not identify that app reliably. Record the browser content with
the modal already fully open; avoid resizing, zooming, moving the window, or
showing/hiding recording controls over the chosen regions during a run.

The original averages 55.626 captured fps, with a 58.334 ms maximum gap. It
cannot exclude an 8.333 ms event. Inspect actual analyzer metrics after the first
capture. If inadequate, establish a higher-rate capture method and **repeat all
baselines with that method** before interpreting zero counts. Aim above 120 fps
where supported; a nominal frame-rate setting alone does not prove coverage.
The analyzer conservatively warns whenever timing cannot cover an 8 ms event.

If possible, also film the physical display with an independent high-frame-rate
camera (for example 240 fps), using fixed exposure/focus. Keep the whole relevant
area visible. Note rolling-shutter/banding artifacts separately. Simultaneous
physical-display and screen recordings help distinguish a displayed glitch from
a capture-only artifact; neither automatically identifies its cause.

## 2. Establish repeated production baselines

For the AI usage modal, save **three independent 120-second recordings**:

```text
baseline-ai-run1.mp4
baseline-ai-run2.mp4
baseline-ai-run3.mp4
baseline-ai-stationary-run1.mp4
```

Use the same workload in each scrolled run: 30 s slow scrolling, 30 s faster
reversals reaching both scroll limits, 30 s slow scrolling, and 30 s stationary.
The stationary control lasts 120 s without scrolling. Leave normal feed and AI
updates enabled. Repeat the three scrolled baselines for the article reader as
`baseline-article-run1.mp4` through `run3`, plus its stationary control. Choose
the same sufficiently long article every time.

If no events occur, extend observation during normal use. Do not conclude that
the issue is gone or that scrolling/polling is exonerated. The original two
events 9.908333 s apart do not establish a 10-second cause or a long-run rate.

## 3. Analyze each recording without changing source timing

In a repository checkout with dependencies installed, the basic command is:

```sh
node tools/experiments/modal-reliability/analyze-recording.mjs /path/to/baseline-ai-run1.mp4
```

If FFmpeg/ffprobe is missing on the Mac, install with `brew install ffmpeg`.
Alternatively, copy videos to this server and run the same analyzer here. No
Playwright installation is needed to analyze a recording. A custom output folder
is available with `--output /path/to/results` when the video's folder is read-only.

The original supplied recording is automatically calibrated. **A new layout or
recording requires its own region calibration.** On first use the analyzer exits
with status 2 and creates `<video>.analysis/region-picker.html`. Open that local
file in Chrome; it performs no network requests. Drag:

1. Two boxes over fixed foreground details. For AI usage choose header/title
   and footer. For the article reader choose its header and a narrow solid panel
   edge clear of scrolling text and the scrollbar. Do not use the moving body.
2. A box over a patterned backdrop area outside the panel where disappearance
   exposes a visibly different background. A featureless patch may be insensitive.
3. Download the configuration and save it as `<video>.regions.json` beside the
   video. Rerun the original command. Review the green/purple boxes and the
   annotated candidate frames manually.

Reuse the same region JSON for other recordings **only when pixel dimensions,
window placement, zoom and modal layout match**. Use separate AI/article/mobile
calibrations. If the first frame is not fully open, use a recording that begins
fully open, or manually calibrate a stable source frame and set `visibleFrame`
to its source index in the JSON.
Never reinterpret a changed layout using the original recording's fixed crops.

The output includes `summary.json`, `report.md`, and annotated neighboring
frames/contact sheet when events are found. Require `status.json` to say
`complete`; failed/calibration-only runs are not successful analyses, and old
artifacts from a previous attempt must not be treated as new evidence.
It preserves source sequence and
presentation timestamps, verifies decoded counts, rejects corrupt/missing frame
timing, and reports source duration separately from the span until reappearance.
Visual candidates do not themselves distinguish CSS hiding from compositor or
recording failure. Ordinary motion/partial changes are excluded by stable regions;
persistent/unbracketed changes are listed separately for review.

Give repeated runs the same configuration label for an exposure-weighted table:

```sh
node tools/experiments/modal-reliability/analyze-recording.mjs /path/to/baseline-ai-run1.mp4 --configuration baseline-ai
node tools/experiments/modal-reliability/analyze-recording.mjs /path/to/baseline-ai-run2.mp4 --regions /path/to/baseline-ai-run1.mp4.regions.json --configuration baseline-ai
node tools/experiments/modal-reliability/compare-recordings.mjs /path/to/baseline-ai-run1.mp4.analysis/summary.json /path/to/baseline-ai-run2.mp4.analysis/summary.json
```

## 4. Test Graphite, then restore it

Open `chrome://flags/#skia-graphite`. Note its original value (the supplied report
used the normal default). Set **Disabled**, relaunch, and export `chrome://gpu`
again as `gpu-graphite-off.txt`. Verify that the **actual backend changed** and
graphics acceleration remains enabled. Do not infer the backend name from a flag.

Record two 120-second matched scrolled runs per affected modal, using names such
as `graphite-off-ai-run1.mp4` and `graphite-off-ai-run2.mp4`. Analyze them with the
same regions and capture settings. Restore the flag to its original value,
relaunch, verify GraphiteDawnMetal, and record another baseline. A/B/A means
baseline → Graphite off → restored baseline, not a single clean control run.

The [related Chromium report](https://issues.chromium.org/issues/551970386)
supports testing this path but does not establish that our symptom is identical.

## 5. Start the separately gated diagnostic origin

Production HTML/CSS/JS remain unchanged. On the repository's Linux server, start
a separate loopback-only process in a terminal:

```sh
cd /home/ubuntu/my-rss-reader
node tools/experiments/modal-reliability/diagnostic-server.mjs --enable --port 4317 --live http://127.0.0.1:3000
```

`--live` explicitly forwards normal API/SSE traffic to the existing backend.
**Normal app actions retain their normal effects**, including read history and
any edits you deliberately make. Do not add keys, save settings, or perform other
unneeded changes during experiments. Login at the diagnostic origin if prompted.
No key/password or article bodies are collected by the diagnostic logger.

Without `--live`, the server uses isolated fixture data. That is useful to check
the switches but is **not** a matched production-data comparison.

On the Mac, in another terminal, replace `YOUR_READER_SERVER` with the SSH alias
or address normally used for this repository, then keep this tunnel open:

```sh
ssh -N -L 4317:127.0.0.1:4317 YOUR_READER_SERVER
```

Open `http://127.0.0.1:4317/?flicker=baseline`. Set the same Glass Light theme,
route, zoom, local preferences, and viewport as production. The new origin has
separate browser storage. Confirm matching cards/content and record a diagnostic
baseline before attributing a difference to a switch. If moving to this origin
or adding instrumentation suppresses the event, that is a confound to investigate.

The server requires `--enable`, binds only loopback, checks Host/Origin, and
rejects cross-origin writes. `?flicker=` on the normal production URL does nothing.

## 6. Run the high-information CSS experiments

Restore the original GPU settings first. Only one `flicker` value is accepted.

| Test URL on port 4317 | Exact change |
| --- | --- |
| `/?flicker=nobgglass` | Removes backdrop filtering on the stationary sidebar/feed header and their descendants/pseudo surfaces; leaves modal glass and scrolled feed cards intact |
| `/?flicker=nobackdrop` | Removes backdrop filtering globally, including prefixed properties/pseudo surfaces; diagnostic only |
| `/?flicker=nomodalblur` | Removes only the AI usage root's backdrop filter; article reader is unchanged |

With the tested modal open, run in DevTools Console:

```js
__flickerDiagnostic.verifyFilters()
```

Require `status: "verified"`, positive visible/inspected counts, and no remaining
filtered targets for that switch. `not-visible` is not success; open the AI modal
before verifying `nomodalblur`. Save the result and close DevTools **before** the
recording so it does not change viewport/scheduling. The console logs the active
configuration; do not record an unverified ablation as a successful experiment.

Run `nobgglass` twice for 120 s per affected modal, then restore diagnostic
baseline and repeat. Evaluate results before running lower-value combinations.
Run `nobackdrop` twice if needed. If only background glass changes the rate,
bisect sidebar versus header in a subsequent narrower experiment; do not deploy
the broad blur removal. If AI-only blur is implicated, compare `nomodalblur` with
the shared-background results. If global backdrop removal helps but background
glass removal does not, isolate remaining card/pseudo-element/modal filters next.
All such appearances are intentionally different
and are not proposed permanent designs.

## 7. Test display refresh separately

Return Chrome flags and CSS to baseline. Open **System Settings → Displays →
Refresh Rate** and choose a fixed **60 Hz** refresh rate if offered, following
[Apple's instructions](https://support.apple.com/en-gb/102297). Record the exact setting; availability
and labels depend on the display/macOS configuration. Repeat two 120-second
matched runs per modal, named `60hz-ai-run1.mp4`, etc. Recheck actual capture
cadence. Reduced capture coverage must not be mistaken for fewer glitches.
Restore the original ProMotion/120 Hz setting and record another baseline.

## 8. Test polling only if the earlier results support it

These switches preserve initial loads and existing data, and suppress only the
specified recurring operation in the diagnostic page:

| Switch | Scope |
| --- | --- |
| `noai2poll` | 2-second `fetchSmartAiProgress` interval |
| `noprovider5poll` | 5-second modal provider-debug interval; unrelated 5-minute background debug check stays intact |
| `noactivity60poll` | 60-second activity interval; unrelated cache timers stay intact |
| `nofeedpoll` | Client automatic Smart briefing scheduling/SSE/viewport application and the known background `fetchData(false,true,true)` path; initial and manual navigation loads remain enabled |

There is no single 10-second production feed poll. `nofeedpoll` is explicitly an
automatic **client refresh** ablation, including pushes; it never stops backend
RSS/Smart processing. Its suppression logs identify what was skipped. Test each
separately twice, with restored baseline runs. Offset/all-poll switches, hiding
the feed, and native-dialog migration have not been added without supporting evidence.

## 9. Correlate a naturally occurring event

The logger retains a bounded ring of request paths/times, real method callers and
completion times, polling callbacks, modal state, and surface mutations. It does
not store API payloads, input contents, screenshots, or GPU logs. Use Control +
Shift + M immediately after noticing an event to mark it. This also adds a named
`rss-flicker-mark-*` User Timing entry to a concurrent Performance trace.
After stopping the video:

```js
__flickerDiagnostic.download()
```

Save it beside that recording. For a separate more-instrumented run, append
`&observe=1`; this also samples modal roots/panels/backdrops, foreground hit tests,
node identities, ancestor/header/sidebar styles and geometry on animation frames.
The ring logs state changes and heartbeats, not a video. Compare instrumented and
light runs because observation may change scheduling and suppress the bug.
For an observed A/B/A series, keep `observe=1` on both baseline and switch URLs.
The clean-exit `restoreBaseline()` action intentionally removes observation;
do not use it to change instrumentation midway through a measured series.

For a trace run, open DevTools **Performance**, keep the same docking/window
configuration throughout compared runs, enable screenshots, begin recording,
and reproduce/continue normal scrolling. Stop promptly after an event and export
the trace beside the MP4 and diagnostic JSON. See the
[Performance reference](https://developer.chrome.com/docs/devtools/performance/reference)
and [Rendering controls](https://developer.chrome.com/docs/devtools/rendering/performance).
An undocked DevTools window avoids
shrinking the page, but its presence is still an environmental difference. Use
Rendering → Paint flashing / Layer borders only in separately labeled runs.

Correlate `timeOrigin + at`, `wallTime`, the keyboard mark, trace timestamps,
and video start/PTS. Save `chrome://gpu` immediately after the event. Do not
attribute historic mailbox errors to it. Identify whether DOM/state changed,
visibility/stacking changed, painting failed with correct state, or only the
capture path shows the loss. Sidebar/header disappearance is evidence of shared
scope, not proof that all fixed layers failed.

If still ambiguous, separately test a fresh extension-free Chrome profile,
Beta/Canary, Safari, Firefox, or temporary graphics-acceleration off. Record exact
versions/backend/capture coverage. Change one setting at a time and restore it.

## 10. Restore, compare, and set the repair boundary

Remove `flicker`/`observe` and reload, or call
`__flickerDiagnostic.restoreBaseline()`. Reload is required: unpatching timer
functions alone cannot revive suppressed intervals. Stop the diagnostic server
and SSH tunnel with Control+C and return to the normal production URL. No service
restart or production rollback is needed; all switches live only in this tool.

Use [RESULTS.md](RESULTS.md) and exposure-weighted analyzer tables. Keep AI and
article layouts separate. Report raw events and recorded durations, not just
clean screenshots. A zero-event sample does not prove zero future events. The
original short clip's observed rate must not be extrapolated. Poisson bounds are
only approximate if capture is adequate and independent, constant-rate events
are plausible; clustered/periodic glitches can violate those assumptions.

Only after a repeated, time-correlated difference identifies a mechanism should
application code change. Preserve a source rollback snapshot first. Validate a
candidate with **three matched 120-second post-fix runs for each principal modal**,
longer if baseline events are rare, plus other modal shells, stationary controls,
polling/feed changes, fast open/close, Escape/outside dismissal, focus and drafts.
Compare identical-setting screenshots for blur/translucency, gradients, colors,
sidebar, borders/shadows, typography and mobile layouts. Measure frame times and
CPU/GPU effects where available; do not trade flicker for broad permanent layer
promotion. Remove diagnostics before production deployment. If no safe workaround
is validated, report the browser/capture outcome and keep production unchanged.
