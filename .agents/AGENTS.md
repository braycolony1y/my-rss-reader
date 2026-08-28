# Tailwind CSS Build Rule

- **CSS Compilation Requirement**: Whenever you add, remove, or modify Tailwind CSS classes in `index.html` (or any other HTML/JS files in this project), you **MUST** run the command `npm run build:css` to compile the Tailwind CSS changes.
- **Cache Busting**: After compiling the CSS, ensure that the cache buster string (e.g., `?v=YYYYMMDD_X`) in the `<link rel="stylesheet" href="/public/styles.css?v=...">` tag within `index.html` is updated so clients fetch the newly compiled stylesheet.

# Smart Articles in Recently Read
- **Recently Read / Saved / Board Filter Logic**: The `filteredArticles` list for `recent`, `saved`, and `board` filters must include all `smartRawArticles`. Because individual smart articles may not exist in `allArticles` or `smartClusters` (which only contains clustered data), `smartRawArticles` provides the full pool needed so that the user's previously read, saved, or pinned smart articles can still be fetched. Do not remove the hydration of `smartRawArticles` into `linkMap` when modifying `filterType` handling in `server.js`.

# Backend Server Restart
- **Restart Requirement**: The Node.js backend server for this project is managed by a systemd service (`rss-reader.service`). It does NOT use nodemon or auto-restart on file changes. Whenever you make modifications to `server.js` or any other backend logic, you **MUST** run the command `sudo systemctl restart rss-reader` for the changes to take effect.
