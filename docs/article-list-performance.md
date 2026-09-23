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
