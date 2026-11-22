# Cross-modal rendering experiment results

Mac experiments are **not executed**: the only connected browser identifies as
Linux x86_64 Chrome 156, not the affected M5 Pro / GraphiteDawnMetal environment.
Pending cells are unavailable evidence, never zero-event results.

| Configuration | Duration | Captured frames | Maximum gap | Dropouts | Rate/min |
| --- | --- | --- | --- | --- | --- |
| Original supplied AI clip (reference only) | 13.878333 s | 772 | 58.334 ms | 2 | 8.647 observed |
| Baseline AI: three 120 s runs | Pending Mac recordings | — | — | — | — |
| Baseline article: three 120 s runs | Pending Mac recordings | — | — | — | — |
| Graphite off: matched repeats + restored baseline | Pending Mac recordings/backend reports | — | — | — | — |
| No background glass | Pending Mac recordings | — | — | — | — |
| No backdrop filters | Pending Mac recordings | — | — | — | — |
| 60 Hz | Pending Mac recordings/capture comparison | — | — | — | — |
| Final fix | No causal repair selected | — | — | — | — |

The original clip contains frames 77 (1.461667 s, 25 ms) and 630 (11.370000 s,
8.333 ms), each followed immediately by reappearance. Their interval is 9.908333 s.
Captured fps is 55.626, duration median 16.667 ms, p95 25 ms, p99 33.333 ms.
Its coverage is insufficient to exclude approximately 8 ms events. Its short-run
observed rate is not an estimate of the application's long-run rate.

The analyzer and development switches have isolated Linux **tool validation**,
not Mac repair verification. See the [follow-up investigation report](../../../docs/modal-flicker-followup-2026-11-07.md) for actual
test results and previous Linux baselines. Attach each run's MP4, region JSON,
analysis JSON/contact sheet, environment note, GPU report, diagnostic JSON and
trace when available. Use A/B/A rather than filling missing results with assumptions.
