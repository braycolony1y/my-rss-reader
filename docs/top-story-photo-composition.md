# Approved Top Story photograph composition

The Light Top Story card now positions its desktop photograph at **48% left with 66% width**. The resulting **114% right extent is intentional**: the existing rounded article card clips it. Position and scale are independent. Source width and height come from the decoded thumbnail, with existing image analysis retained for focal position and palette. The photograph uses `height: auto`, its intrinsic ratio, and `object-fit: contain`.

## Ownership

- `public/top-story-card/blend/desktop-photo.js`: desktop photo geometry and intrinsic source dimensions.
- `public/top-story-card/blend/organic-envelope.js`: one elliptical alpha envelope connecting the left and lower dissolve. The lower feather stays near the source's bottom; the upper/right detail remains opaque.
- `public/top-story-card/blend/photo-envelope.css`: image layers and their responsive presentation, imported by `appearance.css`.
- `fit.js`, `composition.js`, and `runtime.js`: existing module integration and palette/focal state.

Desktop uses a 10% soft duplicate with 14px blur and a 15% ambient field with 70px blur. The desktop text scrim is removed. Geometry derives no values from article titles, links, or publisher identity. Existing framed/transparent artwork handling is retained.

The existing mobile composition remains below the 640px card-width breakpoint. Its fit, reserved image height, masks, and treatment are retained. Header, metadata, title, summary, rank, coverage orbs, freshness, entity cards, and analysis controls were not restructured or restyled. Rank and coverage remain absolute. Hero rules target only the existing photo layers; UI icon images retain their normal dimensions and appearance.

## Verification

`npm test` completed successfully: **567 passed, 0 failed**, followed by the existing server/worker syntax checks. Focused regressions verify that changing the photo anchor does not change its scale or intrinsic proportions, the full 14% overflow is retained, the curved transition reaches zero at the lower source boundary, and decoded source dimensions take precedence over analysis-preview dimensions.

`test/helpers/top-story-photo-browser.mjs` checks live durian and ship cards plus the captured Vietnamese flag photograph at 320, 375, 390, 430, 640, 800, 844, and 1100px viewports/card widths. It measures photo geometry and content rectangles, checks icon isolation, exercises live coverage and analysis controls, verifies text-only read styling, and compares crisp photo pixels with an unmasked render. All 24 required-case/width combinations passed with 0px content shift, 0 mean RGB difference in the crisp photo region, and no browser errors. The live analysis tabs, next control, expansion rail, coverage expansion, source URLs, and read state checks passed. It waits for actual image decoding before photographing the cards.

`test/helpers/top-story-blend-browser.mjs` checks six real thumbnail families at 390 and 800px. All twelve renders passed their existing text-contrast checks. The measured minimum headline contrast was 9.56:1 and minimum summary contrast was 6.63:1. No measured content layout shift occurred. Raw texture/seam measurements are diagnostics; this does not claim conformance to older numeric seam thresholds.

Measured durian card atmosphere at x=12px: RGB(242,242,216) at y=140px, RGB(241,241,214) at y=250px, and RGB(236,237,210) at y=540px. The ship card at the same x=12px measured RGB(237,240,241) at y=140px, RGB(233,239,242) at y=250px, and RGB(229,236,241) at y=480px. These are rendered pixels, not fixed article colors.

Preview images and measurements are stored at:

`/home/ubuntu/.codex/visualizations/2026/10/02/01a0fdc6-1736-7ed0-a79e-c9a9b4e05e14/`

This run verified Chromium. Native WebKit was unavailable; no WebKit result is claimed. Only the pasted design instructions were attached, so exact comparison against the referenced primary screenshot could not be performed.
