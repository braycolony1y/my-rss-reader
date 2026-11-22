# Desktop Top Story photograph dissolve

The desktop photograph remains anchored at **48% left with 66% width**, extending to 114% before the existing card clips it. Height and aspect ratio still come from the decoded source, and the existing focal-position pipeline remains intact. No heading, excerpt, metadata, rank, coverage, fact-card, analysis-panel, or mobile layout rules were changed.

## Changed implementation

- `public/top-story-card/blend/organic-envelope.js`: `desktopLeftMask`, `desktopBottomMask`, `desktopPhotoEnvelope`, and `desktopMaskProperties` generate independent left and lower alpha masks.
- `public/top-story-card/blend/composition.js`: `deriveStoryComposition` supplies the four named desktop mask variables; `organicPhotoMask` delegates desktop masking and retains the existing mobile branch. Geometry and palette calculations are unchanged.
- `public/top-story-card/blend/photo-envelope.css`: inside the existing `@container (min-width: 640px)` editorial-photo rules, hero images intersect the two masks with `mask-composite: intersect` and `-webkit-mask-composite: source-in`. The soft duplicate uses its slightly broader masks. Existing cropped-artwork handling uses the sharp masks.
- Cache references only: `index.html`, `public/image-focus.js`, `public/top-story-card/blend/runtime.js`, `public/top-story-card/blend/appearance.css`, `public/top-story-card/demo/index.html`, and `public/top-story-card/demo/page.js`.
- Validation: `test/story-card-composition.test.js` and `test/helpers/top-story-photo-browser.mjs`. The browser helper accepts selected widths and checks the flag fixture using the original captured source, rather than the demo's baked blur asset.

The old `ellipse 92% 84% at 103% 18%` surrounded the entire photograph with one curved perimeter. Its horizontal and vertical radii coupled the left transition to a rounded lower boundary, producing an oval cutout. The replacement's tall left ellipse controls only the left fade; a separate SVG Bezier contour controls the bottom. Intersection multiplies their alpha, producing a continuous lower-left dissolve without changing image scale.

## Final desktop values

| Property | Sharp photo | Soft duplicate |
| --- | --- | --- |
| Left / width | 48% / 66% | 46% / 68% |
| Left ellipse | 98% × 182%, centered at 100% 42% | 99% × 192%, centered at 100% 42% |
| Bottom | SVG Bezier contour below | Same contour shifted upward 0.8% for the wider feather |
| SVG feather | 11/1000 of image height | 14/1000 of image height |
| Image opacity / blur | 1 / none | 0.10 / 14px |

Both left gradients use these distance/alpha stops:

`0/1, 54/1, 59/.995, 63/.97, 67/.91, 71/.82, 75/.70, 79/.56, 83/.42, 87/.29, 90/.18, 93/.10, 96/.045, 98/.012, 100/0`.

The lower SVG has `viewBox="0 0 1000 1000"`, `preserveAspectRatio="none"`, and this path:

```text
M -120 -120 H 1120 V 944
C 920 963, 810 925, 640 933
C 440 943, 340 908, 200 914
C 60 920, -30 886, -120 894 Z
```

A solid upper field extends to y=820, where the filtered path is already opaque, preventing SVG filter clipping at the top. The lower alpha reaches zero before the physical bottom of the source. There is no linear lower fade and no new text veil. Ambient remains 15% opacity with 70px blur; all image-derived field and panel tint calculations are unchanged.

## Verification

The required `npm test` completed successfully: **567/567 passed, 0 failed**, including the server and worker syntax checks. The first full run was interrupted; this result is from the completed retry. The focused composition, runtime, and blend test files also pass. Independent raster tests verify an opaque upper/right region, a lower contour that changes height across the image, a gradual feather, and zero alpha across the entire physical bottom edge for both masks.

Before/after Chromium measurements on durian and flag fixtures at 390, 639, 640, 800, and 1100px show identical photo geometry, content rectangles, font settings, rank and coverage positioning, card dimensions, and all six sampled field/panel tint variables. Mobile mask values are identical as well.

Live durian and ship cards plus the original captured flag photograph passed at 640, 800, and 1100px (nine renders). Maximum measured content shift was 0px; maximum mean RGB change in the crisp image region versus an unmasked reference was 0.00784/255. Rank and coverage remain absolute. Source icons are unmasked. Analysis tabs, next analysis, more analysis, coverage expansion, publisher links, and text-only read styling passed, with no browser errors. Chromium was verified; no native WebKit result is claimed.

Final browser and full-suite results are recorded with the preview artifacts in:

`/home/ubuntu/.codex/visualizations/2026/10/03/01a0ff20-6e62-7ee0-bb00-44b3ba51eb43/`
