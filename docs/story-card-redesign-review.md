# Editorial story card rendered review

This redesign reuses the production card DOM, actual thumbnail and Alpine controls. It was inspected before editing and rendered repeatedly against the supplied card screenshot and separate original photograph. The exact initial paths, DOM and breakpoints are recorded in [the inspection](story-card-redesign-inspection.md). The current module ownership and reproduction commands are in [the component guide](smart-top-story-card.md).

The initial live 1000px card used a 444×233 photo because scene saliency was treated like face placement. The revised scene uses a complete 599×314 fit, preserving the original 600×315 thumbnail aspect ratio. Neither rank, age nor article content is hardcoded to the reference; the live rank and age continue updating.

## Rendered passes

The first pass revised metadata, typography, context and material, and enlarged the complete scene. Reviewing that render showed an overly white text plane and a horizontal lower haze. Further passes restored the photo-derived blue-gray field, widened the curved blend, moved mobile text before the photo, preserved the full headline and allowed five deck lines for mobile, and corrected fallback metadata/coverage placement so palette readiness causes no movement.

The final pixel review found a subtle straight lower band even after the curve was softened. SVG's default object-bounding-box mask region clipped the Gaussian tail around source row 285. Explicit `maskUnits="userSpaceOnUse"` and full-source bounds remove that premature clip. At the 1000px card, the largest adjacent-channel step across the reviewed lower-edge region at x=850 fell from 10 to 3 on the 0–255 scale. The x=700/950 samples fell from 5/8 to 4/3. These are specific pixel profiles, not a universal perceptual seam score. The unit regression verifies both clear/blurred contour tails remain continuous.

The clear ship region was compared with the same original thumbnail rendered without masks, soft copy or readability layer. Average channel difference was **0.145/255**, 95th percentile **1/255**, maximum **2/255**. The clear image has `filter:none`, opacity 1, no second zoom and retains its source proportions. The photograph remains crisp while the registered duplicate and full-card spatial field carry its color farther.

## Production review

Chromium checked 320, 375, 390, 430, 560, 645, 800, 1000 and 1100px review widths. Mobile actual card widths account for reader gutters. All passed content overflow, full photo aspect ratio, publisher clipping, text-before-photo mobile ordering and horizontal page overflow checks. The finished mask was re-rendered at 390 and 1000px after its last correction.

| Render | Headline minimum | Deck minimum | Analysis minimum | Context minimum |
|---|---:|---:|---:|---:|
| 390px mobile | 10.86:1 | 7.15:1 | 7.29:1 | 11.09:1 |
| 800px card | 10.77:1 | 6.67:1 | 7.23:1 | 11.87:1 |
| 1000px finished card | 10.77:1 | 7.04:1 | 7.23:1 | 11.87:1 |

Contrast is measured against the actual rendered background beneath glyphs. At the 1000px lower transition, sampled colors flow from `rgb(237,241,243)` through `rgb(224,235,245)` to `rgb(206,224,240)` rather than a flat average-color fill.

Next analysis, both main tabs, extra analysis, citation URLs, hover controls and text-only read styling passed on the live card with no page errors. The existing source-count and publisher bindings are retained.

Six existing image families (wood portrait, busy durians, multiple faces, tunnel, expo and illustration) passed at 340/740px: **12 renders**, **0px palette-related content movement**, no clipped publishers, and minimum headline/deck/footer contrasts of **10.19/5.39/7.24:1**. Original face fitting, framed artwork handling and neutral/default-image behavior remain covered by focused tests.

## Checks and limits

Six focused test files passed after the final change. `npm run build:css` passed and the full stylesheet/module import graph uses version `20261002_editorial_3`. The full `npm test` run reported **93/95 test files passing**: the root-layout check rejects the existing `.aws` folder; the HTTP integration test failed with sandbox networking unavailable and passed when rerun with local networking enabled. The existing `.aws` folder was left untouched. This is not a fully clean full-suite result.

The reader reports `ActiveState=active`, `SubState=running`, and `/health` status `ok`. This turn verified Chromium; WebKit was unavailable locally. Styling continues to target the existing light Smart Top variant; the other app themes and card variants keep their existing implementation.

The source supplied separately is 1200×630; production continues using its configured 600×315 thumbnail of the same scene. No per-story asset replacement or fetch-policy change was introduced. The historical six-fixture seam metric includes image subjects and text surfaces and is reported separately, not treated as a passed universal numeric threshold.

Artifacts are stored in `/home/ubuntu/.codex/visualizations/2026/10/02/01a0fd39-ae67-7842-8031-6d224c567cc5/`: `before-desktop.png`, intermediate passes, `finished-1000.png`, `finished-390.png`, `finished-measurements.json`, `final-measurements.json`, `image-family-measurements.json`, `ship-photo-comparison.json`, `mask-edge-comparison.json`, and test logs.
