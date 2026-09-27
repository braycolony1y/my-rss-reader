# Article list review — 2026-09-23

## Confirmed fixes

- Large database snapshots now escape serialized values in 64 KiB pieces and
  write batches asynchronously. Atomic replacement and rollback are preserved.
  Existing parsed arrays are reused for validation when the stored value matches.
- Normal lists reuse unread counts until articles, keywords, read state, or hidden
  state changes. Feed/category pagination avoids an extra whole-library scan.
- Classic filters by destination before cleaning clusters, avoids duplicate sorts,
  and reuses candidate graphs until their actual input snapshots change. Rankings
  are reused within a minute; source/filter changes and Classic editorial changes
  invalidate them. Top analysis completion does not invalidate Classic rankings.
- Top input fingerprints are reused, unnecessary full garbage collections are
  avoided, and pinned pagination keeps its position when a new ranking arrives.
- Switching browser feeds aborts the previous list download.
- Background prefetch called two undefined functions and silently swallowed the
  resulting errors. Both now call the configured strategy dispatcher with the
  intended reading/background priority.
- A long archive scan held the whole scheduling cycle open. Scheduling now releases
  its lock after dispatch, while per-thread and page concurrency limits stay active.

## Measurements

Local live HTTP requests, 40 cards per page, after startup settled:

| View | Repeated requests |
| --- | --- |
| Normal | 17.9–18.2 ms |
| Smart Top | 28.3 ms on the settled request |
| Classic | 31.8–34.6 ms |

Cold/rebuilt views still cost more: observed normal 226 ms, Top 165 ms, Classic
1264 ms during background activity. These are local server measurements, not
end-to-end browser rendering or remote network timings. Another Top request took
320 ms while preparing cards; these measurements do not promise a fixed latency.

The reproducible synthetic writer benchmark in
`tools/experiments/benchmark-json-writer.mjs` wrote a 63.9 MiB snapshot. Whole-object
serialization took 945 ms, with an 804 ms longest event-loop interval; batched
serialization took 1234 ms, with a 44 ms longest interval. This trades total save
throughput for responsiveness and lower transient memory.

## Test and layout repairs

The PDF/clipboard suite failed before reaching export code because its browser
fixture lacked `fetch`. Navigation tests leaked background timers. Other stale
fixtures expected old provider errors/reservations, old archive page projection,
old markup whitespace, and old browser-tab ownership; they now test current
behavior. The clustering fixture now disables live Gemini Web calls.

The production `scripts/` directory is documented and allowed by the layout guard.
Root backup/scratch files were preserved in
`/home/ubuntu/script/cleanup-archives/rss-reader-cleanup-20260923-article-list`.
The cleanup tool now protects the state-overlay file and live atomic-write files.

## September 27 hang investigation

The supplied September 25 sample showed the Node process blocked in
`mem_cgroup_handle_over_high`, roughly 5 GB resident memory, full system swap,
and approximately 93% full memory pressure. September 27 live inspection found
6,396 cgroup `high` events, 4.2 GB process RSS, 0.8 GB process swap, and a 3.2 GB
main heap. The long Board lock waits were therefore not sufficient evidence of
a lock deadlock: memory reclaim could stop the entire HTTP event loop.

Additional changes:

- Frequent Smart status/analysis/editorial updates now use `smart-state.json`.
  A revisioned overlay preserves acknowledged writes across restart and prevents
  stale replay after a full snapshot. This avoids rewriting the 151 MB Smart
  corpus plus its backup for each small update.
- Nested state strings use bounded asynchronous JSON writes too; previously the
  state overlay's nested `values` object still took the whole-object path.
- One-off mutable database reads no longer retain a parsed copy and clone a
  second copy. Existing shared reads keep their cached identity. Save validation
  can reuse the old parsed array until commit.
- Worker admission counts cgroup anonymous memory and swap, rather than only the
  main V8 heap. Temporary list caches and parsed database caches are released
  under pressure, with collection rate limited to once per minute. Ranking keeps
  the last valid publication and retries automatically. A pinned view can reset
  under memory pressure to release its old corpus.
- Workers have explicit heap limits and do not inherit the main process's larger
  heap flag. The deployed main heap is 3 GiB, with MemoryHigh/MemoryMax unchanged
  at 5/6 GiB. Clustering/embedding workers use 1 GiB/512 MiB; ranking uses 1 GiB.
- A systemd watchdog receives event-loop heartbeats and restarts the service if
  they stop for 120 seconds. Existing atomic files protect completed saves.
  Drop-in: `ops/systemd/rss-reader-memory-recovery.conf`, installed as
  `/etc/systemd/system/rss-reader.service.d/zz-memory-recovery.conf`.

Post-deployment local checks returned 40 articles in all three modes. First
requests during background/test activity: Normal 393 ms, Top 438 ms, Classic
2640 ms. Repeated requests: 183/204/125 ms respectively. These confirm working
lists, not a fixed latency guarantee; cold Classic generation still costs more.
Long-term recurrence cannot be ruled out by a short post-restart observation.

The read-only full-corpus worker check successfully ranked **15,851 unique
stories** under an enforced **1,024 MiB worker heap** in **92 seconds**. It did
not write production state or call providers. Reproduce with
`node --max-old-space-size=1536 tools/experiments/verify-ranking-memory.mjs`.
The focused ranking/list/worker suites passed 52/52 checks.

Final verification: `npm test` passed **473/473** tests, followed by the required
server/worker syntax checks. The full suite also exposed presentation fixtures
that could start live AI prewarming; those now inject offline generators.
Provider tests inject isolated quota state rather than using the account's
persisted cooldown. The remaining Timeline, scheduler, Top cutoff/diversity,
roundup, VOZ URL/markup, and runtime-layout fixtures now match their intended
contracts. No export feature defect was demonstrated by the old fixture errors.

Final-build local request pairs (40 cards) were Normal 383/67 ms, Top 292/579 ms,
and Classic 1571/113 ms. Background work affects these timings. The service had
zero cgroup throttling/OOM events and no automatic restarts during the immediate
post-deployment checks; its watchdog heartbeat was confirmed.
