# Smart navigation and Voz performance — 2026-09-23

Tech now uses `#smart/tech_vietnam` and `#smart/tech_global`. Region changes
update the URL and saved view; switching sections retains the selected region.
Old World/Foreign destination aliases normalize to Global, including old
bookmarks. Classic and Top APIs both accept the explicit Tech destinations.
Publisher URLs and proper names containing World remain intact.

Fixed inconsistent Global IDs in source defaults, category inference, editorial
eligibility, and background briefing preparation. Restored a malformed inline
startup script, and made its early request honor the requested tab instead of
always requesting Vietnam News. Updated frontend asset cache versions.

Voz latency had three avoidable contributors:

- The proxy was attempted before an already warm OpenCLI origin context.
- OpenCLI's own FIFO queue discarded the foreground priority assigned by the
  outer fetch scheduler.
- Before replying, next-article prefetch prepared up to five cached article
  bodies merely to determine whether their cache badges should be shown.

The warm browser transport now goes first when permitted by the configured
allowlist. Its queue prioritizes foreground reads and coalesces duplicate URLs.
A verified warm Voz context can use a second fetch slot for interactive work;
cold contexts and publishers requiring navigation remain serial. Prefetch badge
checks use lightweight metadata, with full cache validation retained in the
actual read/prefetch path.

A live CPU profile also identified rebuilding full story lookup maps on each
viewport update. Immutable published snapshots and pinned views now reuse their
indexes through a WeakMap, allowing obsolete snapshots to be collected.

## Verification

- 38 targeted tests passed, including Tech URLs, both API modes, legacy
  category compatibility, browser lease reuse, priority and duplicate handling,
  metadata-only prefetch checks, and database persistence/recovery.
- JavaScript and inline-script syntax checks passed; Tailwind rebuilt.
- The full suite was attempted with a timeout. Existing failing/hanging tests
  prevent a clean full-suite result. A separate broad ranking run also retains
  the existing synthetic-event count failure (3 versus 15).
- The service was restarted and `/health` returned `ok` with sync enabled.
- Live Classic Tech API reads returned HTTP 200 and the correct region:
  Vietnam 642 ms; Global 845 ms.
- Two uncached refresh requests for the same Voz thread returned HTTP 200,
  59,173 characters of content, and only `opencli-fetch` in attempted methods:
  693 ms and 797 ms. These are observed warm-session timings, not a guarantee
  for every publisher response or browser state.

CPU changes remove confirmed repeated work; no claim is made here about a
controlled percentage reduction in total server CPU.
