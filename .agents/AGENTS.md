# Tailwind CSS Build Rule

- **CSS Compilation Requirement**: Whenever you add, remove, or modify Tailwind CSS classes in `index.html` (or any other HTML/JS files in this project), you **MUST** run the command `npm run build:css` to compile the Tailwind CSS changes.
- **Cache Busting**: After compiling the CSS, ensure that the cache buster string (e.g., `?v=YYYYMMDD_X`) in the `<link rel="stylesheet" href="/public/styles.css?v=...">` tag within `index.html` is updated so clients fetch the newly compiled stylesheet.
