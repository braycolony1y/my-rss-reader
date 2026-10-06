# Feed loading follow-up — 6 October 2026

The earlier memory optimization could evict a shared parse while a presentation view still held it. A later read then allocated a second graph and broke identity-based reuse. The strong cache remains limited to 192 MiB estimated source bytes. A bounded, expiring WeakRef index now recovers a graph only while another owner or the garbage collector still has it. It does not prevent collection; writes, changed raw JSON, explicit clears and expiry invalidate it. The activated server reported 29 recovered reads in its first resource sample.

The largest reproduced Top delay was separate repeated filtering: `topSnapshots.get()` rechecked the entire published collection against personal and system exclusions on every request. That accounted for 4.2–7.5 seconds in the `persisted-read` timing. Published filtering now reuses results for the same immutable snapshot, personal state and system decision revision. Apply, Undo, system decisions, feature switches and snapshot replacement invalidate reuse. Passes that change state are not cached. Entries use weak snapshot ownership.

Personal story identity calculation also repeatedly normalized and hashed unchanged article bodies. Its extracted module caches only compact identity results under weak article keys, checks every input field, and checks related members separately. It retains no normalized full-body copies. Regression tests compare the old algorithm and serialization, including edited fields and related members.

## Live measurements

Same local API, 40 articles, Smart destination `tech_vietnam`, explicit `smartMode=top` or `classic`. All responses were HTTP 200. These are observations under changing host activity, not a controlled whole-system speedup.

| View | Before, repeated/warmed | Final activation, repeated/warmed |
| --- | ---: | ---: |
| Normal | 68 ms | 142 ms |
| Top | 4,646–8,290 ms | 504 ms |
| Classic | 1,510–1,691 ms | 597 ms |

Another activated pass measured Normal 176 ms, Top 635–1,095 ms and Classic 851 ms. Normal was already fast and these samples do not establish an improvement for Normal. Top's repeated persisted-read phase fell to about 0.2–1.2 ms.

First requests after restarting remained slower: final activation Normal 689 ms, Top 5,409 ms, Classic 3,124 ms. Initial loading and new publication/filter revisions still require actual work. The changes remove repeated work rather than delaying requests or removing filtering. Network/browser rendering time is not included in these localhost measurements.

The new live process was approximately 2 GiB RSS in an early sample. This is a startup observation, not a mature RAM comparison. The existing image, sanitation, vector streaming and bounded background-work optimizations remain. No production provider or filter was disabled and no concurrency/heap limit was raised.

## Scope

New implementation modules: `src/database/weak-parses.js`, `src/smart/feedback/identity.js`, `src/smart/prefilter/published-view.js`. Integration changes are limited to the existing parsed-cache, personal store and publication modules. New regression coverage is in `test/loading-reuse.test.js`; the existing strict-LRU test explicitly disables weak recovery to continue testing the strong-cache policy independently.

Final `npm test`: **727/727 passed**, including HTTP integration, Top snapshot reuse, filtering, worker and memory-pressure recovery tests. All eight changed/new JavaScript files passed syntax checks.

The first restricted run had two failing integration files. A serial host rerun passed HTTP and exposed an unnecessary system-filter read for non-Vietnam publications. The new module was corrected to preserve section-scoped lazy loading (and empty-snapshot behavior). The final complete host run passed after this correction; earlier failure logs are retained for traceability.

Final activation: PID 2241378, active/running with zero restarts; health returned OK after startup. Tests ran against isolated fixtures. The measurement JSON records the preceding activation; the final adjustment only avoids unnecessary system-filter state access for out-of-scope or empty snapshots.
