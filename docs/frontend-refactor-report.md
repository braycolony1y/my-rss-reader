# RSS Reader frontend refactor — final report

The current-workspace baseline was preserved. `index.html` is reduced from
7,075 to 116 lines (98.4%); `script.js` from 8,807 to 41 lines (99.5%). The
application retains Alpine and Express, with no new framework, build system,
or browser-side HTML loader.

## Final module tree

```text
index.html (116 lines)
script.js (41 lines)
public/js/
├── ai
│   └── status.js
├── app
│   ├── bootstrap.js
│   ├── component.js
│   ├── persistence.js
│   └── server-events.js
├── article
│   ├── embeds.js
│   ├── export.js
│   ├── navigation.js
│   ├── overlay.js
│   ├── prefetch.js
│   ├── presentation.js
│   ├── speech.js
│   └── summary.js
├── board
│   ├── cache.js
│   ├── folders.js
│   └── view-heartbeat.js
├── feeds
│   ├── content-filter.js
│   ├── list.js
│   ├── management.js
│   ├── navigation.js
│   └── reading-state.js
├── smart
│   ├── focus-lease.js
│   ├── navigation.js
│   ├── sources.js
│   ├── top-stories.js
│   └── viewport-priority.js
├── sources
│   ├── ground-news.js
│   ├── tinhte.js
│   ├── voz-lease.js
│   └── voz-thread.js
└── ui
    ├── diagnostics.js
    ├── layout.js
    └── tooltips.js
public/styles/
├── article
│   ├── content.css
│   ├── embeds.css
│   ├── light-content.css
│   └── responsive-overrides.css
├── components
│   ├── ai-status.css
│   ├── edit-source.css
│   └── suggested-articles.css
├── layout.css
├── sources
│   ├── ground-news.css
│   ├── techmeme.css
│   ├── tinhte.css
│   ├── tuoitre.css
│   ├── voz-pagination.css
│   ├── voz-signatures.css
│   └── voz.css
└── themes
    ├── light-controls.css
    ├── light-surfaces.css
    └── surfaces.css
public/components/
├── action-status.html
├── article
│   ├── overlay-header.html
│   ├── overlay.html
│   └── summary.html
├── article-card.html
├── article-list.html
├── header.html
├── login.html
├── modals
│   ├── add-feed.html
│   ├── ai-providers.html
│   ├── ai-status.html
│   ├── article-debug.html
│   ├── boards.html
│   ├── cache.html
│   ├── content-filter.html
│   ├── edit-source.html
│   ├── logs.html
│   └── smart-sources.html
├── sidebar.html
├── smart
│   └── navigation.html
└── tooltip.html
src/ui/
├── client-modules.js
├── reader-partials.js
└── reader-assets.js
```

Existing image-focus, image-palette, card-image-layout, liquid-tint,
article-panels, card-blend and top-story-card modules keep their existing homes.
The existing article-card partial is unchanged.

## Old section → new module

| Old section | New home |
| --- | --- |
| Layout, scrolling and WebKit paint workarounds | `public/styles/layout.css` |
| VOZ posts, spoilers and link previews | `public/styles/sources/voz.css` |
| X/Reddit fallbacks and source-deleted notices | `public/styles/article/embeds.css` |
| Article text, images, media, quotes, tables and code | `public/styles/article/content.css` |
| Suggested article carousel | `public/styles/components/suggested-articles.css` |
| Ground News, Techmeme, Tinhte and Tuoi Tre presentation | `public/styles/sources/` |
| Dark/light surfaces and light control overrides | `public/styles/themes/` |
| AI status and edit-source presentation | `public/styles/components/` |
| Late source and responsive overrides | `public/styles/sources/voz-pagination.css`, `voz-signatures.css`; `public/styles/article/responsive-overrides.css` |
| Startup and authentication | `public/js/app/bootstrap.js` |
| Server events and reconciliation | `public/js/app/server-events.js` |
| Saved snapshots and preference writes | `public/js/app/persistence.js` |
| Alpine composition | `public/js/app/component.js`; `script.js` |
| Smart regions and Top/Classic navigation | `public/js/smart/navigation.js` |
| Top Story analysis, key facts, coverage and refresh | `public/js/smart/top-stories.js` |
| Smart source settings/discovery | `public/js/smart/sources.js` |
| List requests, pagination, card identity and hover | `public/js/feeds/list.js` |
| Feed/category navigation and reordering | `public/js/feeds/navigation.js` |
| Feed add/edit/remove and synchronization | `public/js/feeds/management.js` |
| Reading/saved/hidden state and synchronization | `public/js/feeds/reading-state.js` |
| Content filters and preview | `public/js/feeds/content-filter.js` |
| Overlay lifecycle and fetch-method comparison | `public/js/article/overlay.js` |
| Routes, deep links and source URL identity | `public/js/article/navigation.js` |
| Twitter widget hydration | `public/js/article/embeds.js` |
| Article prefetch queue | `public/js/article/prefetch.js` |
| Copy, print and PDF export | `public/js/article/export.js` |
| Audio/speech | `public/js/article/speech.js` |
| Summaries, analysis and VOZ summary progress | `public/js/article/summary.js` |
| Source times, text and image URL presentation | `public/js/article/presentation.js` |
| VOZ resume, validation, pagination and continuation | `public/js/sources/voz-thread.js` |
| Ground News and Tinhte DOM handlers | `public/js/sources/ground-news.js`, `tinhte.js` |
| Board folders, cache rules and post history | `public/js/board/folders.js`, `cache.js` |
| Board, Smart focus/viewport and VOZ leases | `public/js/board/view-heartbeat.js`; `public/js/smart/focus-lease.js`, `viewport-priority.js`; `public/js/sources/voz-lease.js` |
| Sidebar/theme, tooltips and diagnostics | `public/js/ui/` |
| Provider health, keys and usage viewer | `public/js/ai/status.js` |
| Login/sidebar/header/list/overlay/dialog markup | `public/components/` |
| Asset composition, partials and cache invalidation | `src/ui/` |

## Code intentionally retained in entry files

Only two inline scripts remain: the image-focus loading flag with its existing
eight-second fallback, and the authenticated early Smart News request. The
request still starts while the document is parsing, before the body exists.
The image-focus ES module and deferred Alpine scripts retain their positions.

The HTML entry retains metadata, ordered asset references, shared body
`x-data`/`x-init` and window events, the main container, and partial markers.
Small Alpine expressions and DOM event attributes remain unchanged with their
feature markup.

The script entry defines public `rssApp`, lists feature factories, and installs
listeners/leases in their original order. Factories are synchronous classic
script modules composed into the existing `/script.js` response. A deferred
ES-module dependency graph could let Alpine start before `rssApp` is defined;
preserving that execution boundary is the reason for synchronous composition.
Existing independent ES modules, including image focus, remain ES modules.

Property-descriptor composition keeps computed getters lazy and gives methods
the complete Alpine proxy as `this`. Each instance gets fresh mutable state.
Features communicate through the established component interface; no circular
imports or extra browser requests for partials are introduced.

## Verification

- All 493 public component descriptors, initial values, and method/getter
  bodies match the original workspace. All 14 independent startup listener
  registrations and storage reads match.
- Rendered body markup is byte-identical except the script cache version.
  Head elements retain their execution order apart from stylesheet extraction.
- All 549 extracted top-level CSS rules/comments are byte-identical and retain
  their order. Duplicate CSS and compatibility comments are preserved.
- Tailwind was rebuilt with the new source locations; its output is
  byte-identical to the original. Asset cache versions were updated.
- Chromium passed all six combinations of 390/1440px and classic/glass/glass-light:
  startup/early request, sidebar states, Global region, Top/Classic, overlay
  open/close/scroll, source widgets, refresh, deep links and authentication-dependent
  loading. No page errors or failed script/style responses; console warnings
  match the original fixture.
- A focused Chromium flow passed read state, hide-read, search, feed filtering,
  suggested-article navigation, native browser Back, overlay close and persisted
  browser state.
- Of 24 ordinary before/after screenshots, 17 were pixel-identical. The other
  differences were consistent with animation timing. A repeat with animations
  paused produced eight pixel-identical screenshots across the two affected
  mobile/desktop theme cases, including expanded sidebars.
- Composition/cache tests cover lazy getters, proxy `this`, isolated state,
  nested partials, missing/circular includes, edited dependencies invalidating
  cached responses, syntax, and early-request guards/parameters.
- Existing tests now inspect composed sources or their owning modules instead
  of slicing the old monolith.
- The full suite was run at each phase. The final broad run passed 87/90 test
  files: two baseline failures remain, and a Ground News test still assumed
  the old script layout. That assumption was subsequently corrected and its
  focused rerun passed. Final frontend test results are recorded below.
- Server/feed-worker syntax and tracked-file whitespace checks passed.
- The service was restarted for renderer changes. Live `/health` returned
  `status: ok`; the composed page/script were retrieved; all 27 referenced
  local scripts/stylesheets returned HTTP 200.

The final focused run passed all 15 frontend test files (zero failures),
including navigation, list loading, exports, reader safety, prefetch, filters,
Smart navigation/analysis, reading-state synchronization, VOZ rendering,
Ground News interactions and the new module/renderer regressions.

## Limits and existing issues

Native Safari/WebKit could not run because the WebKit executable is absent.
Its workarounds are retained byte-for-byte. X/Reddit fallback presentation and
Twitter hydration regression tests were checked; live third-party widget
availability was not asserted by the browser fixture.

The existing project-layout test rejects the pre-existing `.aws` directory.
The existing isolated HTTP smoke test fails in the restricted environment;
a retry with networking enabled reached provider/browser initialization and
exceeded its 30-second timeout. The full suite is therefore not clean.

A service watchdog restart occurred while the full suite and browser checks
ran concurrently. It recovered and passed live health/asset checks. No runtime
policy was changed during this refactor.

The existing AI Providers dialog references `refreshAiProvidersStatus()`
without a client definition; this was preserved. The duplicate `debugModalOpen`
initialization was also preserved.

## Change statistics

[Refactor-only before/after Git stat](frontend-refactor-task-stat.txt):
90 implementation/test/map files, 16,679 insertions and 15,821 deletions.
Most lines are existing code and markup moved to their feature homes.

[Requested git diff --stat against HEAD](frontend-refactor-git-stat.txt) also
contains substantial changes already present before this task and excludes
untracked files, so it does not describe this refactor alone. No existing
workspace changes were reverted or committed.

The boundaries are feature-owned presentation, behavior and markup; one shared
Alpine component interface; and server-side asset/partial composition with
dependency-aware cache invalidation.
