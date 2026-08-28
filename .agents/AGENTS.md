# Tailwind CSS Build Rule

- **CSS Compilation Requirement**: Whenever you add, remove, or modify Tailwind CSS classes in `index.html` (or any other HTML/JS files in this project), you **MUST** run the command `npm run build:css` to compile the Tailwind CSS changes.
- **Cache Busting**: After compiling the CSS, ensure that the cache buster string (e.g., `?v=YYYYMMDD_X`) in the `<link rel="stylesheet" href="/public/styles.css?v=...">` tag within `index.html` is updated so clients fetch the newly compiled stylesheet.

# Smart Articles in Recently Read
- **Recently Read / Saved / Board Filter Logic**: The `filteredArticles` list for `recent`, `saved`, and `board` filters must include all `smartRawArticles`. Because individual smart articles may not exist in `allArticles` or `smartClusters` (which only contains clustered data), `smartRawArticles` provides the full pool needed so that the user's previously read, saved, or pinned smart articles can still be fetched. Do not remove the hydration of `smartRawArticles` into `linkMap` when modifying `filterType` handling in `server.js`.

# Backend Server Restart
- **Restart Requirement**: The Node.js backend server for this project is managed by a systemd service (`rss-reader.service`). It does NOT use nodemon or auto-restart on file changes. Whenever you make modifications to `server.js` or any other backend logic, you **MUST** run the command `sudo systemctl restart rss-reader` for the changes to take effect.

# Workspace Organization

- Keep the repository root limited to production entry points, package/configuration files, and local runtime state already documented in `README.md`.
- Put maintained automated tests in `test/`; put test-only inputs in `test/fixtures/` and generated test output in `test/fixtures/generated/`.
- Put reusable experiments and diagnostics in `tools/experiments/`. Use `/tmp` for disposable scratch files and remove them after the task.
- Put operational scripts in the appropriate `ops/` subdirectory: backups in `ops/backup/`, maintenance in `ops/maintenance/`, and service snapshots in `ops/systemd/`.
- Do not leave temporary, experimental, duplicate, obsolete, patch, debug, copied, or one-off test files in the project root. Remove them when safe or quarantine uncertain items outside the live tree.
- Run `npm test` before handoff. The `test/project-layout.test.js` guard must continue to pass when root files or top-level directories change intentionally.
