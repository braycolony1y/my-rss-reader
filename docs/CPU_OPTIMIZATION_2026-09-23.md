# CPU investigation — 2026-09-23

The running RSS server initially averaged about 77% of one CPU core. The
service's memory counter was approximately 4.7 GB. Browser processes were also
busy; these changes address server work.

## Confirmed hotspots

A 16.46-second live main-thread profile attributed approximately 4.25 seconds
to UTF-8 encoding, 2.49 seconds to the atomic JSON writer, and 2.42 seconds to
garbage collection. The main database was approximately 89 MB and the Smart
database 137 MB. Fetch statistics save every five seconds, and destination
cache updates save every three seconds. Previously these small metadata changes
rewrote the main database and its backup. Each file larger than 5 MB also forced
a full garbage collection.

After optimizing persistence, another profile identified copying, parsing, and
serializing the Board identity ledger as the next major cost. It contained
103,243 identities and approximately 19 MB of JSON. Every observed feed copied
the ledger and refreshed timestamps even for identities already known. These
identity timestamps do not drive expiry; dismissal timestamps do.

## Changes

- Use the existing durable state overlay for fetch statistics, destination
  cache updates, and batches consisting entirely of state keys.
- Skip byte-identical stored JSON updates, including unchanged keys in batches.
- Let V8 schedule garbage collection instead of forcing collection after each
  large file write.
- Read the identity ledger without copying it for unchanged observations.
  Copy its maps only when identities or dismissals change. Preserve shared
  entries and rollback safety, including when persistence fails.
- Keep new-identity capture, pending capture retries, and dismissal expiry.
  Previously seen identity entries are no longer refreshed solely to record
  feed activity. Existing identity history is retained.

## Validation

Eleven targeted tests passed: database recovery, state overlay replay ordering,
failed-save rollback, unchanged saves, startup, new-article detection, old-thread
recognition, dismissal expiry, pending capture retries, and shared-ledger safety.
The persistence test's stale cache-version expectation was updated from 56 to
the existing production version 58. Syntax checks passed.

The broader suite was attempted with normal local permissions and then with
timeouts because existing tests hang. The bounded run recorded 315 passes,
34 failures, and 21 cancellations at its three-minute deadline. Failures include
frontend harnesses without `fetch`, existing Board scan expectations, and the
root-layout guard rejecting pre-existing backup and scratch entries. This is
not a clean full-suite pass.

Two isolated replays quantified the affected operations:

| Replay | Before CPU | After CPU | Before writes | After writes |
| --- | ---: | ---: | ---: | ---: |
| Six small metadata/Board save calls against a copy of the main corpus | 16,038 ms | 4 ms | 1,149,467,097 bytes | 635 bytes |
| Observe 50 known articles in the 103,243-entry identity registry | 956 ms | 1 ms | 19,059,707 bytes | 0 bytes |

The first replay uses synthetic small metadata values; real state overlays can
be larger. The second isolates registry processing with in-memory persistence.
These are operation-level measurements, not a claimed reduction in total live
CPU. Startup feed fetching, Smart processing, and browser activity still use CPU.

The systemd service was restarted to load both changes. A final 20.02-second
sample measured 23.2% of one CPU core, and `/health` returned `ok` at 71 seconds
uptime with sync enabled, 47 feeds seen, and 1,153.6 MB process RSS. The initial
77% reading was a process-lifetime average, so these readings are observational,
not a controlled before/after percentage improvement.
