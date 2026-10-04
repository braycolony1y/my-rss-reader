# Mobile Smart Top layout

`public/top-story-card/mobile-top-layout.js` and its paired stylesheet own the light-theme Smart Top layout at viewport widths up to 767px. Classic and Standard cards share the mobile presentation without receiving any new content elements. Desktop image framing remains unchanged. Both the reader and the captured-card preview load this module.

`MOBILE_TOP` contains the layout constants. The module consumes existing focal-point and palette variables. Mobile retains the bottom-region color picker and uses the same lightness/chroma treatment as desktop through `blend/light-surface.js`; the shared base lightness is approximately 0.9533. Both the feather and lower card reveal this one surface. The direct SVG alpha mask uses nearly level, softly interpolated contours on the original photo. There is no painted feather layer or duplicated photo.

The heading stays static, with a 20px lift and 14px top padding. Metadata anchors to the relative header. Publisher names can truncate; counts greater than one retain their full pill. Single-source counts are hidden by the shared card template on desktop and mobile. Coverage follows the measured metadata edge and scrolls horizontally within its reserved space when the rail cannot fit every orb. Existing links and coverage actions remain intact.

`mobile-photo-framing.js` consumes the detected face bounds and the measured metadata rail. Metadata stays fixed over the photo. The crop always covers the top, left, and right edges; positive offsets and shrinking below cover size are disallowed. Zoom and crop position keep detected faces below the rail where the source permits. The photo area can grow vertically to accommodate the zoomed face above the feather. Images without a detected face retain their existing focal crop. A successfully decoded default thumbnail remains visible and uses the same heading spacing as an extracted image.

The mobile bottom mask preserves full opacity through the upper 85% of the image. The desktop organic bottom mask preserves the upper 92%; its left mask and focal framing are unchanged. Compact desktop cards also use a shorter bottom feather.

A scoped observer batches rerender changes through animation frames. Resize observers update mask dimensions and metadata geometry. Identical writes are skipped; leaving mobile, changing theme/layout, or excluding a card removes module-owned state. Previous compact rules explicitly exclude the active mobile module while retaining their desktop behavior.

Validation:

- `node --test test/mobile-top-mask.test.js` checks alpha preservation, the restrained contour, and transparency at the image boundary.
- `node --test test/mobile-photo-framing.test.js test/top-story-blend-runtime.test.js` checks cover geometry and valid default-thumbnail visibility.
- `node test/helpers/card-image-fill-browser.mjs` checks default/extracted images in Top, Classic, and Normal at mobile and desktop sizes, including edge coverage, fixed metadata, and heading spacing.
- `node test/helpers/mobile-top-layout-browser.mjs` checks six captured cards at 320, 375, 390, 414, 430, 440, and 767px using the production stylesheets, plus desktop scope and resize/rerender cleanup. Requires Chromium and a reader at port 3000. Outputs previews and measurements under `/tmp/mobile-top-review` (or `CARD_OUTPUT`). An optional `baseline.json` there compares pre-change desktop computed styles.
