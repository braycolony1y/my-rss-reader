# Historical adaptive Top Story card review

This review records the preceding implementation. The current editorial composition and its measurements are documented in [the redesign review](story-card-redesign-review.md).

The Liquid Glass light Top Story uses thumbnail-derived ambient color, a contained photo, softer text, frosted chips, and a translucent analysis panel. The latest correction replaces focal zoom and individual face cutouts with one uniform image fit and a broad fade into a clear right section. It also revises font sizes and section proportions, as requested: the headline leads smaller supporting text, and two compact stat tiles fill the insight panel's width. Production component markup, article copy, source-fetch policy, tab behavior, and three-line clamps remain in use.

Changed implementations live in the `public/top-story-card/blend/fit.js`, `masks.js`, `runtime.js`, `appearance.css`, `hierarchy.css`, and `coverage.css` modules. The card shell imports the relevant styling modules. Existing analysis and image baking remain in `src/images/top-story-blend/`.

## Inputs and measured palette

These are the reader's actual thumbnails from the six supplied story links, not the 1200×630/1017×572 originals described in the brief. Dimensions and compression differ, so the brief's numerical tolerances are not all met. Values below use the cropped image for S6. The regression fixtures retain the actual downloaded bytes.

| Sample | Reader pixels | Hue / accent | Mean chroma | Coherence, measured / brief | Average L, measured / brief | Busyness, measured / brief | Desktop treatment |
|---|---|---|---|---|---|---|---|
| S1 wood portrait | 800×606 | 64° / 66° | .074 | .973 / .980 | .613 / .650 | 638 / 347 | B; peach, calm |
| S2 durians | 800×450 | 108° / 108° | .107 | .991 / 1.000 | .634 / .640 | 6716 / 5290 | B; pistachio, busy |
| S3 faces and flags | 800×449 | 28° / 26° | .059 | .634 / .650 | .529 / .530 | 4933 / 4050 | B; blush, busy |
| S4 tunnel | 800×450 | 90° / 52° | .034 | .571 / .480 | .623 / .620 | 2982 / 2372 | B; warm gray, moderate |
| S5 expo | 800×533 | 280° / 297° | .027 | .782 / .740 | .655 / .680 | 3951 / 3850 | B; periwinkle, busy |
| S6 illustration | 800×450 | 230° / 221° | .105 | .929 / .950 | .596 / .580 | 2453 / 2378 | G; aqua, moderate |

The durian accent stays olive rather than selecting the small neon object. The illustration stays blue-teal rather than selecting the pink icons. The tunnel has no detected faces and uses spectral saliency. S1 has one face, S3 two, and S5 seven after duplicate suppression. No watermark-specific cropping or retouching is performed.

## Browser results

Chromium rendered six samples at 340, 560, and 740 CSS pixels against light and dark page backgrounds: 36 combinations. Comparing palette application enabled/disabled on the revised component measured **0 px** change in heading, metadata, title, summary, panel, tabs, body, chevron, avatar stack, and rank rectangles. This checks paint stability; it does not claim unchanged sizes or wrapping from the earlier design. Headline weight is 600 and both title and summary retain their three-line clamps. The panel uses `blur(24px) saturate(150%)` and a 70% derived tint, with a 92% fallback without backdrop filtering.

The rendered photo uses `object-fit: contain`, no transform, and a uniform source aspect ratio within .001. Its full dimensions fit inside the hero, with no second focal scale and no radial face mask. Headline sizes stay within 22–28px, summaries within 14–16px, and analysis body within 13–15px. The source stack overlaps on small cards so the overflow chip remains visible.

Minimum contrast on the real composite, sampled beneath rendered glyphs:

| Card width | Headline (≥7 required) | Summary (≥4.5) | Footer (≥4.5) |
|---|---|---|---|
| 340 | 10.71 | 7.11 | 4.68 |
| 560 | 10.71 | 7.11 | 4.69 |
| 740 | 9.73 | 5.57 | 4.66 |

The full regression command `npm test` passed **545 tests, 0 failures**, including regressions for complete source fit, tiny thumbnail enlargement, avatar avoidance without clipping, removal of stale face masks, hidden lazy-image loading, late palette results, transparent artwork, population-weighted accents, cropping, and token flipping. This correction changes frontend modules; it requires no backend restart.

The actual linked wood story also passed the production browser check at 645/800/1100 px card widths and 390/320 px mobile viewports. Its processed hero decoded successfully, the palette caused no layout shift, and the live tabs, next control, extra-analysis rail, publisher expansion, source destinations, hover toolbar, and text-only read styling passed with no page errors. The two-face story passed at 800/560/390 px: its stat row and insight panel have equal widths; at 800px the two stat tiles are each 376px with a 10px gap, and below 420px they stack.

## Deviations and acceptance limits

- **The earlier literal raw seam gate is not met.** Profiles include sharp subjects and texture as well as blend boundaries; their values are recorded in the generated browser measurements. The latest request prioritizes complete thumbnails and a clear right section. Passing geometry/contrast checks is not presented as passing this earlier ≤2.5% numeric gate.
- **The dark option is a page-background diagnostic.** Production styling targets the existing Liquid Glass light card. Classic, standard, and dark app cards retain their existing appearance. All six samples derive light tokens; dark token flipping is covered by a synthetic dark-image unit test. This is not verification of the requested full dark-app matrix.
- S6 has three qualifying ridges at the specified 60/255 threshold in the resized reader image; its top ridge falls below that threshold. All four sides are cropped by 6.44%, compared with approximately 5.6% in the brief. The requested four detected ridges are not claimed.
- All photo samples now use a complete-scene fit instead of choosing a cover crop for single subjects. Their positions and photo width can differ from the earlier target approximations. Ambient color covers space around portrait or smaller contained images.
- Legibility uses a broad left scrim that becomes transparent by approximately 60% of desktop card width. The entire right section is clear rather than exposing individual oval face holes. A soft scrim local to the footer text meets the faint-text contrast gate without introducing a full-width strip.
- Expensive blur levels are baked once; responsive wrapper alpha masks and two viewport-gated blur strips remain CSS. Analysis runs through the existing cached image-focus path on first request rather than adding a separate feed-ingest job. The in-process analysis key includes URL and content hash; persisted focal metadata follows the existing versioned URL cache.

## Reproduction

Open `/public/top-story-card/demo/` for the six captured cards and width, page background, and debug controls. Debug shows clusters, focal box, target, mode, masks, avatars, panel top, and melt start. S1 retains the original captured card copy; the other five examples use their own story headline/summary with the same captured panel for visual comparison.

Run `node test/helpers/top-story-blend-browser.mjs` for the composite measurements and `node test/helpers/top-story-card-browser.mjs` for the actual linked reader card and its interactions. `READER_URL`, `CARD_OUTPUT`, and `CHROMIUM_PATH` are optional. Measurements are saved with the screenshots; the raw seam values are reported separately from layout and contrast assertions.
