# Liquid Glass ambient card blending

The latest brief is implemented through `public/card-blend/`, `src/images/card-blend/`, and the existing article component. It applies to Light-mode Top Stories, Classic, and normal/VOZ cards. Existing content, title typography, card radius/border and glass finish remain in the component/surface module. No Show/Hide details button has been restored.

## Latest user clarification

The user waived the three specific reference photographs and prioritized a clear thumbnail, restrained haze, and separation from text. Accordingly, the sharp horizontal ramp ends at 50–60% of the image column rather than the brief's 70–80%. The mobile bottom fade is capped at 80px rather than covering most of a 16:9 banner. These intentional differences are recorded in the QA report; the original numeric checks are still reported rather than silently weakened.

## Modules and stored assets

- `public/card-blend/color.js`: exact source-pixel area averaging in OKLab into a 24×16 grid; chroma-weighted reference hue, hue-limited normalization, sRGB gamut mapping and fixed-lightness tokens.
- `src/images/card-blend/assets.js`: decodes with EXIF orientation and an input-pixel limit, builds a 96×64 bicubic/sigma-3 ambient WebP and a 320px sigma-6 melt WebP. Both are cached with image metadata.
- `src/images/card-blend/melt.js`: lifts the baked melt to its local ambient lightness/chroma floor. This resolves the brief's conflict between an ordinary dark blurred photo and its prohibition on a darker/grayer melt. The numeric ambient chroma floor also supersedes the prose .035 floor where gamut permits.
- `public/card-blend/masks.js`: reusable 11-stop smootherstep ramps, shared by every card; no per-card hand tuning.
- `public/card-blend/runtime.js`: safely assigns bounded WebP assets/tokens and updates the plate height and animated `--fy` from actual geometry.
- `public/card-blend/legacy-color.js`: preserves palette behavior for other themes and clears stale assets on source changes/default images. It performs no runtime blur.
- `public/card-blend/surface.css`, `layout.css`, `content.css`: separate finish/typography, image layout/layers, and content styling. `public/liquid-cards.css` is the import entry point.
- `public/components/article-card.html`: ambient → melt → sharp/harmonize → content, with one specular layer. The optional entity slot renders only supplied entity data; no article entity content is invented.
- `public/card-image-layout.js`: viewport integration; `public/image-focus.js` retains focal detection/crop behavior and calls the new color module.
- `src/images/focal-detector.js` and `focal-cache.js`: image-focus results include `blend` metadata, with cache version 11. Browser/session cache keys also use version 11.

The metadata stores `h_ref`, `c_ref`, `edgeL`, `k`, `ambientImage`, `meltImage`, and actual encoded byte counts. Static WebP data URLs are generated once per uncached thumbnail and persisted, not recomputed while scrolling. This is build time for demo inputs and cache-creation time for dynamically arriving articles. The normal image-focus queue and stale-response handling remain in use.

## Layout and rendering

Desktop headers are two-column grids, text 48% / image 52%, changing to text 52% / image 48% at a 1100px card width. The image spans the heading and optional entity row. It stays sharp at its top/right edges, with the horizontal transition confined to its own column; the photo never moves under title or excerpt.

Full-width KPI/panel content follows the header. With a following visible row, the bottom mask uses `max(140, (.30 + .10*k) × plateHeight)` pixels and the melt gets an additional 24px tail. Without a following row, the desktop image bleeds to the card bottom and omits the vertical mask. `--fy` and the panel's grid rows animate over 280ms; reduced-motion settings disable motion.

Below 640px card width the image is a full-width 16:9 banner above the text, with only a bottom mask. Its fade is `min(80, .4 × plateHeight)` to honor the user's latest concern about excessive haze.

The ambient covers the image column, extends 30% of card width leftward and 160px below, and uses eased horizontal/vertical masks. Sharp and melt layers use intersected masks. A .16 color-blend harmonizing overlay stays inside the sharp plate; the melt uses saturation 1.15. No live blur filter is applied to image layers. The card keeps one backdrop filter and one localized specular highlight.

KPI tiles use three columns, switching to one below 560px. Icons are 20px monoline SVGs. Panel content is top-aligned with 16px/20px padding; tabs and arrows use the image-derived accent. Read title ink is OKLCH L=.40.

## Build and preview

```
node scripts/images/build-card-blend.mjs input.jpg output/prefix
node scripts/images/build-card-blend-fixtures.mjs
npm run build:css
```

The first command writes ambient/melt WebPs and metadata JSON. The second rebuilds seven labeled diagnostic illustrations and assets under `public/tint-demo/fixtures/`.

`/public/tint-demo/index.html` shows each fixture expanded and collapsed, with 360/720/1100px widths, mode/read controls and an external demo panel toggle. No demo toggle is added to production cards. `?debug=1` overlays saved 2x-browser sample coordinates and prints L/C/H plus per-4px delta-L. These are saved measurements for the matching fixture/width/state, not a claim of live DOM pixel capture.

## Validation

- `node --test test/card-blend.test.js`: OKLab-before-resize behavior, transparent-pixel weights, normalization, masks and encoded assets.
- `node test/helpers/image-focus-browser.mjs`: actual composed card markup in all three modes, six viewport sizes, mobile banners, no image behind the panel, stable crops, read state, reduced motion, and pixel equality in the clear portion of the harmonized plate.
- `node test/helpers/liquid-tint-browser.mjs`: 42 rendered cases at device scale 2, with original strict thresholds retained in `public/tint-demo/measurements.json`.
- `npm test`: full application regression suite.

The current 42-case report passes contrast (minimum 6.44:1), midpoint-chroma continuity, entity-row coverage, no runtime blur, and one backdrop filter in every case. Not all of the brief's original chroma, hue, lightness-step and tint-spread targets pass. Mobile bottom-length failures are intentional after the user's clarification. Original sharp fixture edges also contribute to measured lightness steps. Do not describe this report as full numeric QA compliance.

Captures: `test/fixtures/generated/ambient-card-360.png`, `ambient-card-720.png`, `ambient-card-1100.png`, plus the production component captures. The current fixtures are diagnostic illustrations, as agreed; production cropping is independently exercised by the component browser test.

Latest validation (2 October 2026): the full application run passed 531 of 532 tests; the isolated HTTP integration test exceeded its 30s timeout during that run and passed unchanged on an isolated retry in 7s. Client/backend syntax checks pass. Production browser checks pass across all three card modes at six widths. The running service is active, `/health` returns 200, and live HTML/module checks confirm the new assets and the absence of the removed details button. The live debug overlay and normal-mode inert handling also pass.
