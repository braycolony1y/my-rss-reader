# My RSS Reader

Production RSS reader served by `rss-reader.service` from `/home/ubuntu/my-rss-reader`.

## Directory layout

- `server.js`, `index.html`, `script.js`: application entry points.
- `src/`: source adapters and shared modules.
- `public/`: compiled CSS and static assets.
- `test/`: maintained regression tests used by `npm test`.
- `test/fixtures/`: stable test inputs; generated fixtures belong under its ignored `generated/` directory.
- `tools/experiments/`: reusable experiments and diagnostic prototypes, never production entry points.
- `docs/`: architecture, audit, and implementation notes.
- `ops/backup/`: daily GitHub backup tooling.
- `ops/maintenance/`: safe maintenance utilities.
- `ops/systemd/`: restore snapshots of the production systemd service.

`database-state.json` durably stores lightweight Board updates until the next full database snapshot. Keep it alongside `database.json` when backing up or restoring live state.

Runtime databases, caches, environment files, and API keys remain local and are excluded from the public GitHub backup.

The private rolling online-AI usage report is refreshed every five minutes at `/home/ubuntu/script/logs/online-ai-usage-last-24h.log`. It contains only the last 24 hours and is intentionally excluded from the public backup.

Disposable work belongs in `/tmp`, not in the repository. Obsolete or uncertain files should be moved to the external cleanup quarantine documented in `ops/maintenance/` until they can be safely deleted. A regression test enforces the allowed top-level layout.

## Verification

```bash
npm test
```

The production service compiles Tailwind CSS before starting. After backend changes, restart it with:

```bash
sudo systemctl restart rss-reader
```

## Server PDF downloads

The reader's PDF button queues a persistent job on the VPS and downloads the finished
file directly. Thread exports include all discovered pages (no 250-page cap), render
in small batches, and resume from the last completed batch after a restart or retry.
Closing the reader leaves the job running; the Pause button pauses it. Reopen the
thread and select Download PDF to retrieve the file or reconnect to its progress.
Unavailable pages stop generation rather than exposing an incomplete PDF as complete.

Private job checkpoints and completed files live under `article_cache/pdf/` and are
excluded from backups to the public repository. PDFs follow the ordinary cache's
14-day last-known-content retention. Saved/Board content stays protected unless
source deletion has been confirmed: deleted snapshots and their PDFs expire 14 days
after confirmation, even if saved/pinned. Dedicated Cache archives (including post
history) expire 14 days after leaving Cache; returning before expiry cancels that
departure deadline. PDFs for those archives share the departure deadline. Existing
departed archives without a recorded departure date get 14 days from migration. Hourly housekeeping removes expired exports; expired downloads are
also rejected immediately. A finished PDF is a dated snapshot and is reused until
expiration.

Runtime requirements: `puppeteer-core` (installed by npm), Chromium (default
`/snap/bin/chromium`, overridable with `PDF_CHROMIUM_PATH`), and `qpdf` for merging
large exports without retaining the entire document in the Node heap.
