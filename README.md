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

Runtime databases, caches, environment files, and API keys remain local and are excluded from the public GitHub backup.

Disposable work belongs in `/tmp`, not in the repository. Obsolete or uncertain files should be moved to the external cleanup quarantine documented in `ops/maintenance/` until they can be safely deleted. A regression test enforces the allowed top-level layout.

## Verification

```bash
npm test
```

The production service compiles Tailwind CSS before starting. After backend changes, restart it with:

```bash
sudo systemctl restart rss-reader
```
