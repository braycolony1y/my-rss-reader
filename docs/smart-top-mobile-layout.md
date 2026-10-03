# Mobile Smart Top layout

`public/top-story-card/mobile-top-layout.js` and its paired stylesheet own the light-theme Smart Top layout at viewport widths up to 767px. Classic and Standard cards are excluded. Both the reader and the captured-card preview load this module.

`MOBILE_TOP` contains the layout constants. The module consumes existing focal-point and palette variables without changing their calculation. The direct SVG alpha mask uses asymmetric, softly interpolated contours on the original photo. There is no painted feather layer or duplicated photo.

The heading stays static, with a 34px lift and 14px top padding. Metadata anchors to the relative header. Publisher names can truncate; the source count retains its full pill. Coverage follows the measured metadata edge and scrolls horizontally within its reserved space when the rail cannot fit every orb. Existing links and coverage actions remain intact.

A scoped observer batches rerender changes through animation frames. Resize observers update mask dimensions and metadata geometry. Identical writes are skipped; leaving mobile, changing theme/layout, or excluding a card removes module-owned state. Previous compact rules explicitly exclude the active mobile module while retaining their desktop behavior.

Validation:

- `node --test test/mobile-top-mask.test.js` checks alpha preservation, the irregular contour, and transparency at the image boundary.
- `node test/helpers/mobile-top-layout-browser.mjs` checks six captured cards at 320, 375, 390, 414, 430, 440, and 767px using the production stylesheets, plus desktop scope and resize/rerender cleanup. Requires Chromium and a reader at port 3000. Outputs previews and measurements under `/tmp/mobile-top-review` (or `CARD_OUTPUT`). An optional `baseline.json` there compares pre-change desktop computed styles.
