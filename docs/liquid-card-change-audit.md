# Article-card redesign audit — 1 October 2026

Historical snapshot: the 2 October ambient rebuild supersedes the transition/layout status below. See [the current implementation and validation notes](liquid-article-cards.md) for that later, separately requested work.

Scope: the transition adjustments and the subsequent full pasted redesign in this conversation. This is a reconstruction from the recorded editing commands and current files, not a diff against a clean commit. The checkout already contained many unrelated changes and deletions. Those are not attributed to this redesign.

## Requested corrections in the latest turn

- Removed the added Vietnamese/English Show/Hide details button from production cards and the demo. Top Story analysis stays visible; its tabs still work. Classic coverage retains its existing +N control.
- Moved the horizontal fade, soft-copy fade, sharp-copy fade and tint lift into the seam ending at approximately 52% of card width. The right photo area is fully sharp and opaque.
- Fixed the displayed photo viewport at 58% width so this clear boundary is consistent for all thumbnails. The older adaptive-width metadata is still computed but no longer controls the CSS viewport.
- Moved the bottom feather into a reserved 48px tail below the main header content. The image remains clipped above the panel.
- Reduced the text column from 50% to 48%, increased its desktop right padding from 8px to 16px, and slightly darkened read-state ink from OKLCH L=.49 to .47 to preserve contrast next to the clear photo.
- Updated the browser checks, demo measurements, documentation and stylesheet cache version. Added `test/helpers/card-photo-clarity.js`, which compares the clear rectangle against the same image with every fade/lift disabled.
- Saved the latest browser header preview as `test/fixtures/generated/liquid-corrected-header.png`, using the original article photograph with fixture text/metadata.
- No other redesign feature has been rolled back in this turn. The internal Top Story collapse methods remain in the panel module, but production markup no longer calls them or hides Top Story details.

## Previous changes, grouped for rollback decisions

| ID | What the previous pass touched | Current status / rollback relationship |
| --- | --- | --- |
| A | Shared transition styling across Top Stories, Classic and normal/VOZ cards. Earlier iterations moved the Top fade from card 40–50% to 50–70%; the full redesign then spread it across the entire photo. | Latest correction replaces the broad fade. The shared application to all three modes remains. |
| B | Header/panel separation: two card rows, image confined to the header, stable image crop when analysis or coverage grows. Normal cards have no analysis panel. | Retained. This prevents the photo appearing through or beside expanded content. |
| C | Added Show/Hide details control and per-story expanded state; analysis tab selection reopened the panel. | Visible control removed now. Top analysis is always open. Internal state methods remain unused by production collapse controls. |
| D | Panel animation: 280ms grid expansion, 8px slide, 120ms delayed fade, inert collapsed content and reduced-motion handling. Moved Classic's extra coverage into a panel below the header. | Retained for Classic's existing coverage control. Can be rolled back independently of tint extraction; coordinate with the card markup. |
| E | Panel appearance: 14px inset, 20px corners, translucent white surface, white border, hue-colored shadow, removal of a second backdrop blur. Rewrote shared card surface/heading/metadata/rank/read-state rules in the light-card stylesheet. | Retained except the text width/padding/read-ink corrections above. Styling can be changed without undoing modularization. |
| F | Accent colors: changed active tabs, underline, chevron, links and blue utility colors inside light cards to a thumbnail-derived accent. Chevron size/hover motion also changed. | Retained. Independent visual rollback option. |
| G | Three-band tint extraction: 64×64 samples, seam x=10–45%, top/middle/bottom hues, chroma-weighted averaging, P90 chroma, neutral fallback/inheritance and adjacent-hue smoothing. New tint/shadow/accent tokens and a vertical hue field over a flat reading surface. | Retained. Roll back the extraction and corresponding CSS tokens together. |
| H | Progressive soft/sharp photo layers and edge brightness lift. Generated a tiny blurred/desaturated WebP plus a sharp sampling WebP on the server; local-image fallback generates a tiny soft copy in the browser. | Retained, but both layers and lift are now confined to the seam. Removing the soft layer requires coordinating markup, CSS, browser metadata and server assets. |
| I | Browser crop-aware tint sampling, resize handling and cached image decoding. Added 48%/58% adaptive width based on seam contrast and a per-viewport lock to avoid width/crop feedback loops. | Sampling/caching retained. Adaptive width is now superseded by a fixed displayed width, as described above. |
| J | Image metadata cache version 9 → 10, new `softImage` and `sampleImage` fields, browser session-cache invalidation, and handling of stale/default images. | Retained. A rollback of H/G/I should also update cache compatibility so old/new metadata do not mix. |
| K | Modularization: extracted article markup, panel state, and image-header geometry; added an HTML/script asset composer and minimal entry-point wiring. Tailwind now scans the card component. | Retained. These modules comply with the requested modular-code rule and need not be removed to roll back visual choices. |
| L | Rebuilt the diagnostic demo into five expanded/collapsed pairs, added fixtures and pre-rendered soft images, expanded tests, saved measurements/screenshots, and updated documentation. | Retained and updated for the latest correction. Demo collapsed Top examples are diagnostic states, not a production collapse control. |

The Show/Hide button was an implementation choice made while interpreting the pasted expandable-panel requirement. The pasted note specified expansion behavior but did not explicitly request a new text button.

## Complete maintained-file inventory from the previous pass

Paths below are relative to `/home/ubuntu/my-rss-reader`.

### Production UI and integration

| File | Work performed |
| --- | --- |
| `public/liquid-cards.css` | Transition iterations, then shared light-card/header/panel styling, two image layers, color fields, accents, animation and read-state rules. |
| `public/liquid-tint.js` | Replaced single-seam tint calculation with three bands, contrast metric, new tokens and full-width mask stops. |
| `public/image-focus.js` | Soft/sharp metadata loading, actual-cover-crop tint sampling, adaptive-width lock, header observation, fallback cleanup and module integration. |
| `public/card-image-layout.js` | New extracted module for header viewport and visible-photo height; preserves other-theme geometry behavior. |
| `public/components/article-card.html` | New extracted article template; added header/panel wrappers, soft image and detail control; relocated Classic coverage. Existing article metadata, title, excerpt, analysis and actions moved with the component. |
| `public/article-panels.js` | New extracted state module for selected analysis, panel expansion/reset and toggles. |
| `index.html` | Replaced article template with the component marker; updated stylesheet/client asset versions. |
| `script.js` | Integrated the panel-state factory/reset; moved the touched analysis-toggle implementation into its module. |
| `src/ui/reader-assets.js` | New module that composes the HTML card and prepends the panel module to the client script, with file-change revalidation. |
| `src/routes/page-routes.js` | Wired HTML/script responses to the asset composer. |
| `src/images/focal-detector.js` | Added tint metadata plus tiny soft/sharp WebP generation to focal results. |
| `src/images/focal-cache.js` | Bumped metadata cache version to 10. |
| `tailwind.config.js` | Added `public/components/**/*.html` to scanned content. |
| `public/styles.css` | Regenerated compiled Tailwind stylesheet. |

### Demo, assets and documentation

- `public/tint-demo/index.html` — shared-style demo, paired expanded/collapsed cases, mode/read controls and photo upload.
- `public/tint-demo/busy.svg` — added conference illustration.
- `public/tint-demo/sky.svg` — added bright-sky portrait illustration.
- `public/tint-demo/busy-soft.webp`
- `public/tint-demo/dark-soft.webp`
- `public/tint-demo/white-soft.webp`
- `public/tint-demo/gray-soft.webp`
- `public/tint-demo/sky-soft.webp` — five generated soft counterparts.
- `public/tint-demo/measurements.json` — generated rendered-pixel measurements, including recorded failures of the pasted strict seam thresholds.
- `docs/liquid-article-cards.md` — implementation and validation notes.

The existing `dark.svg`, `white.svg` and `gray.svg` were reused; they were not changed by the redesign.

### Tests with substantive changes

- `test/liquid-tint.test.js` — seam boundary, three-band color/fallback behavior, smoothing, chroma and adaptive token assertions.
- `test/image-focus.test.js` — tiny soft/sharp WebP metadata validation.
- `test/filter-briefing-regressions.test.js` — independent panel state and analysis selection/reopening, plus composed-source loading.
- `test/reader-assets.test.js` — new renderer composition, dependency ordering and changed-component revalidation checks.
- `test/helpers/reader-source.js` — new shared loader for the composed HTML/client source.
- `test/helpers/image-focus-browser.mjs` — production card fixtures, header/crop stability, all three modes, desktop/mobile sizes, panel pixel isolation, read state and reduced motion.
- `test/helpers/liquid-tint-browser.mjs` — five-case rendered-pixel measurements, text contrast, panel/header boundaries and mobile demo checks.

### Tests changed only to load the composed HTML/client source

- `test/article-list-loading.test.js`
- `test/article-export.test.js`
- `test/article-navigation.test.js`
- `test/article-reader-safety.test.js`
- `test/fetch-method-policy.test.js`
- `test/ground-news-source.test.js`
- `test/mobile-ui.test.js`
- `test/smart-navigation-performance.test.js`
- `test/top-stories-snapshot.test.js`
- `test/voz-rendering.test.js`
- `test/voz-thread-state.test.js`
- `test/source-time.test.js`
- `test/tuoitre-source.test.js`
- `test/helpers/filter-briefing-browser.mjs`
- `test/helpers/story-analysis-browser.mjs`

### Generated captures from the previous pass

Under `test/fixtures/generated/`:

- `liquid-production-1440.png`
- `liquid-production-390.png`
- `liquid-production-320.png`
- `liquid-panel.png`
- `liquid-panel-hidden-photo.png`
- `liquid-tint-desktop.png`
- `liquid-tint-390.png`
- `liquid-tint-320.png`
- `liquid-tint-backgrounds.png`

These are regenerable evidence, not application assets. Temporary scripts/logs and scratch screenshots under `/tmp` were also used and cleaned up.

## Runtime actions and boundaries

- Ran the CSS build, application tests and browser fixtures; restarted `rss-reader.service` to activate backend asset-renderer and image-metadata changes.
- Normal metadata requests generated version-10 entries under `article_cache/image-focus/`; no wholesale cache deletion or database migration was performed by this redesign.
- No commit or pull request was created by this work.
- This work did not change feed selection/ranking, AI prompts/providers, source scrapers, article export behavior, or VOZ thread loading logic. Relevant tests only changed their source-loading helper as listed above.
- The large existing dirty tree, root-file deletions, changes to `server.js`, `src/input.css`, package manifests and unrelated source/backend modules predate this work. Do not use a repository-wide reset to roll back these card changes.

## Validation limits

The previous pass reported 528 passing application tests and successful layout checks. Its saved QA report also recorded failures against the pasted strict photo hue/chroma and per-4px lightness limits; those targets were not all satisfied. Passing application tests did not establish that the visual result matched the desired clear rectangle.

The latest correction adds a direct rendered-pixel comparison for that clear rectangle. It does not claim that every original photographic edge satisfies the earlier strict gradient limits.

Latest results: 528/528 application tests pass. The synthetic and original-article-photo browser runs pass, including exact clear-region pixel checks in all three modes at 1440/390/320px, header/panel geometry at six widths, Classic expansion, read state and reduced motion. The diagnostic demo passes its contrast and layout assertions (minimum sampled contrast 5.83:1 unread, 4.69:1 read). Live HTML/CSS checks confirm the button is absent and the revised stylesheet is served.
