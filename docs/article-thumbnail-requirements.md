# Article thumbnail requirements

The light-theme desktop Top Story presentation and its shared Standard, Smart Classic and VOZ presentation use one photo box. The shared presentation is active at viewport widths of at least 768px and card inner widths of at least 640px. Existing compact and mobile layouts remain separate.

- Keep the approved desktop photo anchor at 48% left and its independent width at 66%. The card clips the intentional right overflow. PNG alpha pixels must not select a different desktop box.
- Start every photo layer at the card top. Update the hero, plate, sharp photo and soft copy together.
- Without visible analysis, end every photo layer at the actual card bottom. Retain only the left mask; apply no bottom feather or bottom SVG.
- With visible analysis, end every photo layer 18px below the measured analysis-panel top. Begin the short outer feather at that top edge. Keep the area above it clear.
- Use cover fitting for vertical coverage without stretching the source, adding a transform scale or running another focal detector. Preserve the resolved focal coordinates for both copies.
- Continue the sampled visible lower-edge colors into the space below analysis. The computed gradient must actually paint; a ready-state flag alone is insufficient.
- Preserve content positions, dimensions, truncation, typography, metadata, icons, ranking, coverage controls, fact cards and analysis interactions. Fact text must remain readable over the photograph.
- Read state may change text colors; it must not dim, blur, recrop or recolor the thumbnail.
- Preserve configured image selection, load/fallback behavior, and the existing mobile framing and feather.

## Ownership

`blend/fit.js` and `blend/desktop-photo.js` select the desktop box. `hero-extent.js` measures live endpoints through the existing image lifecycle. `hero-extent.css` controls the conditional outer feather. `shared-card-style/photo-placement.css` adapts the same box to shared cards. `edge-colors.js` samples the visible cover crop; `edge-colors.css` paints the continuation.

## Verification

- `test/story-card-composition.test.js` checks that alpha pixels preserve desktop geometry and resolved focus while stacked fitting remains separate.
- `node test/helpers/thumbnail-placement-browser.mjs` checks Top, Normal and Classic at three desktop card widths, ordinary/alpha sources, top and bottom coverage, analysis overlap and dynamic panel changes, actual gradient painting, fixed content/focus, read-state photo preservation, fact contrast, icons, and mobile/theme isolation.
- `node test/helpers/card-image-fill-browser.mjs` checks extracted/default images across Top, Classic and Normal at mobile and desktop widths.
- `npm test` remains the required suite before handoff.

The affected saved VOZ matcha article must also be inspected in the real reader. Fixture validation alone is insufficient. Browser evidence is Chromium unless another browser is explicitly recorded.
