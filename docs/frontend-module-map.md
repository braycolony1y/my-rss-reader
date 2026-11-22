# Frontend modularization

## Inventory before extraction

The starting workspace has `index.html` (7,075 lines, including one 3,405-line
style element), `script.js` (8,807 lines), and existing uncommitted work. The
refactor uses that workspace as its baseline, not the older Git HEAD.

Express serves `/` and `/script.js` through `src/routes/page-routes.js` and
`src/ui/reader-assets.js`. The renderer already inserts
`public/components/article-card.html` into the page and prepends
`public/article-panels.js` to the script. `/public` is served by Express static
middleware. There is no frontend bundler or client-side partial loader.

Existing browser modules: `image-focus.js`, `image-palette.js`,
`card-image-layout.js`, `liquid-tint.js`, the `card-blend/` and `top-story-card/`
modules, and `article-panels.js`. Existing styles: compiled `styles.css`,
`board-cache.css`, `liquid-cards.css`, and the card styles in those directories.
These retain their current ownership and relative loading order.

The body owns `x-data="rssApp()"` and explicitly calls `initApp()`. Nested
sidebar/hover/search/provider-health scopes inherit that component. The large
factory contains state, computed getters and methods that call other methods
through `this`; these must remain one Alpine object. Accessors must be copied
as descriptors, not evaluated by object spread. Event-handler closures capture
the Alpine proxy during initialization.

## Critical order and public boundaries

1. Compiled Tailwind and legacy card base styles.
2. Inline image-focus loading flag and eight-second fallback; existing image
   focus ES module, which installs its DOM observer at its current timing.
3. Inline authenticated Smart News prefetch, before body parsing. It retains
   cookie checks, saved-state guards, hash parsing and request parameters.
4. Deferred Alpine collapse plugin followed by deferred Alpine core.
5. Extracted CSS in exactly its original rule order, then existing HLS script
   and remaining card/cache styles.
6. Composed classic `/script.js` at the end of the body, before deferred Alpine
   executes. Feature factories and installers are composed on the server to
   preserve this ordering without an asynchronous module graph or new build.

Public globals include `rssApp`, `ArticlePanels`, Alpine, Hls, Twitter's
`twttr`, `__rssInitialDataRequest`, `__rssTwitterWidgetsPromise`,
`__smartRefreshTiming`, and the four existing installed flags for board cache,
AI focus, Smart viewport and VOZ leases. Preserve the globals, storage keys,
cookies, API calls, events, hash routes, DOM selectors and Alpine attributes.

## Proposed ownership / extraction sequence

| Existing responsibility | Destination |
| --- | --- |
| Scroll/layout and overlay paint workarounds | `public/styles/layout.css` |
| Article typography, embeds, media and light reading overrides | `public/styles/article/` |
| VOZ, Ground News, Techmeme, Tinhte and Tuoi Tre presentation | `public/styles/sources/` |
| Suggested cards and settings/status dialogs | `public/styles/components/` |
| Shared dark/light surfaces and control overrides | `public/styles/themes/` |
| Independent publisher handlers and four background leases | `public/js/sources/`, `public/js/board/`, `public/js/smart/` |
| Startup, authentication, server events and component composition | `public/js/app/` |
| Smart navigation, briefing analysis and source settings | `public/js/smart/` |
| Article loading, overlay, routing, exports, speech and summaries | `public/js/article/` |
| VOZ pagination, resume and live continuation | `public/js/sources/voz-thread.js` |
| Feed navigation, management, content filters and reading state | `public/js/feeds/` |
| Sidebar, theme, tooltips and diagnostics | `public/js/ui/` |
| Board folders, cache rules and post history | `public/js/board/` |
| Persisted snapshots and preference writes | `public/js/app/persistence.js` |
| Login, sidebar, header, list, overlay and dialogs | `public/components/` |
| Server-side composition and cache invalidation | `src/ui/` |

CSS extraction precedes independent scripts, then Alpine factories, then HTML
partials. CSS fragments may have explicit later override files where merging
them into an earlier source file would change the cascade. No duplicate rules
or legacy comments are removed. Source modules have no circular imports;
feature methods communicate through the existing Alpine component interface.

## Validation plan

Save original rendered HTML/script and CSS outside the live tree. Compare
exact CSS token order, reconstructed markup, factory property descriptors,
method bodies and independent listener installation. Run the existing tests
at each phase, plus browser fixtures exercising actual Alpine startup,
authentication, navigation, overlays, persistence, themes and responsive
layout. Compare before/after screenshots and computed styles. Check asset
responses, initial request timing and browser errors. Restart the systemd
service when renderer changes are ready, then verify live health and assets.

## Pre-existing observations

- The baseline test suite reports failures in `project-layout.test.js` and
  `server-http.test.js`; these are being investigated separately from changes.
- The AI Providers dialog references `refreshAiProvidersStatus()` without a
  definition in the existing client script. Preserve and document it rather
  than introducing an unrelated behavior change.
- `debugModalOpen` is declared twice with the same value; extraction preserves
  that duplicate rather than silently cleaning it up.

## Completed extraction

The final entry files are 116 HTML lines and 41 JavaScript lines. See
[the final report](frontend-refactor-report.md) for the implemented tree,
section mapping, validation evidence, statistics and verification limits.
