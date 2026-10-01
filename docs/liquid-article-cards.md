# Liquid Glass light-mode article cards

The Alpine/HTML card lives in `public/components/article-card.html` and uses the shared styles in `public/liquid-cards.css`. `index.html` contains only its component marker; `src/ui/reader-assets.js` composes the card into the shell and revalidates changed files. The same renderer serves the scoped client module `public/article-panels.js` before the legacy reader factory. `script.js` integrates that module through a single state/method factory call. Top Stories, Classic articles and normal articles (including VOZ threads) receive the same image transition and tint treatment. Other themes retain their existing layout through `display: contents` wrappers.

## Header and panel

A light-mode card has two grid rows: `.article-card-header` and `.article-card-panel`. The image belongs to the header and is clipped there. Expanding Classic Full Coverage or changing analysis content never resizes the header image or paints it underneath the panel. Normal cards use the header without an analysis panel.

The panel wrapper animates `grid-template-rows` between `0fr` and `1fr` over 280ms ease-out. Its inner content fades and slides 8px, with a 120ms opening delay. Collapsed content is inert. Reduced-motion users receive no transition or slide. Top Story details stay visible without a Show/Hide details control; Classic coverage uses its existing +N control. The panel module retains its internal state methods, but production Top Story markup no longer depends on the collapse state.

`public/card-image-layout.js` owns header bounds and visible-photo height. In Light mode, crop calculations depend only on the header; panel visibility and scroll position do not participate. The displayed photo width is fixed at 58% so the clear boundary remains consistent across images.

The analysis surface is inset 14px, with a 20px radius, translucent white fill, a fine white border and a hue-tinted shadow. It adds no backdrop filter. Tabs, underlines, chevrons, citations and coverage links use the card's accent rather than the global blue.

## Extraction and cached assets

`public/liquid-tint.js` exports `extractLiquidTint`, `rgbToOklab`, `tintProperties` and the horizontal mask stops. Extraction reads a 64×64 sRGB sample of the seam at x=10–45%, split into top, middle and bottom bands. It rejects pixels outside OKLab L=.20–.97 for hue/chroma, weights the remaining a/b values by chroma squared and stores P90 chroma. A neutral band inherits its closest colored neighbor; all-gray images use hue 250 and chroma .03. Adjacent hue differences are limited to 20 degrees. Brightness includes all opaque seam pixels.

The metadata contains `h1/h2/h3`, `cs1/cs2/cs3`, legacy `cs` (middle band), `edgeL` and mean OKLab seam-to-tint distance (`contrast`). `src/images/focal-detector.js` also bakes a 64px-wide soft WebP (blur 2.5px at the small resolution, saturation .85) and a tiny sharp sample. Version 10 of `src/images/focal-cache.js` persists these with the focal point by thumbnail URL. Generation happens once during metadata creation; scrolling does not blur full-size images. Dynamic article photos cannot be pre-rendered at application build time; bundled demo fixtures include pre-built soft assets.

`public/image-focus.js` decodes the small sharp sample once per source and projects the actual header cover crop onto a 64×64 canvas. Each card extracts its visible seam bands when geometry changes, including on viewport resize. The older adaptive-width metadata still chooses 58% or 48%, but the current stylesheet fixes the displayed width at 58%; crop sampling uses that actual geometry. Cached source metadata supplies a fallback when sampling fails. The browser keeps bounded metadata/sample caches, invalidates stale image responses, and removes the prior soft copy when a card switches to the default illustration.

## Tokens and rendering

For each band, `--ta-i = oklch(.93 Ca_i h_i)` with `Ca_i = clamp(cs_i × .9, .04, .075)` and a .05 cap for yellow/lime. `--tint-b` is `oklch(.962 clamp(mean(Ca) × .5, .025, .04) h2)`. `--tint-deep` supplies the shadow at L=.80 and `--accent` is `oklch(.48 .11 h2)`. The legacy `--tint-a` aliases the middle band.

The card has a flat `--tint-b` base. A vertical three-band color field in the header ramps from transparent at 25% of the card width to opaque at 70%, then eases back to the base over the header's last quarter. Expanded content sits on that base, avoiding a dark frame.

The photo occupies the right 58% of the header. Its eased horizontal mask ends at 17% of the image viewport, corresponding to 51.86% of card width. The sharp-copy fade and screen lift end at the same point, leaving the region from 52% rightward fully opaque and unfiltered. The soft copy is confined to this seam. The text column is 48% wide, with extra right padding on desktop.

The bottom mask remains opaque through the main content area, then dissolves over a reserved 48px tail. This moves the feather below the photo rectangle rather than washing over the subject. Neither image layer has a runtime filter. Only the card surface has a backdrop filter. Read state preserves the photo and tint and uses ink at L=.47 to maintain contrast beside the new seam.

## Standalone structure

```html
<div class="theme-glass-light">
  <div id="scroll-container">
    <article class="liquid-card article-card">
      <div class="article-card-header">
        <div class="article-card-image">
          <img class="thumbnail-soft" src="thumbnail-soft.webp" alt="" aria-hidden="true">
          <img class="thumbnail-img" src="thumbnail.jpg" alt="">
        </div>
        <div class="article-card-heading">
          <div class="article-metadata"><span>Source</span></div>
          <h2>Article title</h2><p>Article summary.</p>
        </div>
      </div>
      <div class="article-card-panel" data-expanded="true">
        <div class="article-panel-content">
          <div class="article-briefing"><div class="story-analysis-shell">Details</div></div>
        </div>
      </div>
    </article>
  </div>
</div>
```

Apply `tintProperties(tint)` to the article's inline CSS custom properties. Change `data-expanded` and the inner content's inert state together when toggling a standalone panel.

## Demo and validation

`/public/tint-demo/index.html` shows five controlled local illustrations, each expanded and collapsed: a busy red/green conference scene, dark navy, white-background product, grayscale and a portrait against a bright sky. The requested conference photograph was not present in the pasted text; the illustration is explicitly labeled. The demo includes Top/Classic/Normal controls and accepts photo uploads.

- `npm test`: unit and application regressions, including three-band extraction, cached assets, stale responses and independent panel state.
- `node test/helpers/image-focus-browser.mjs`: production markup at 320, 375, 390, 430, 844 and 1440px, fixed header crops during Top/Classic expansion, no image painting behind/beside panels, read state and reduced motion.
- `node test/helpers/liquid-tint-browser.mjs`: rendered-pixel QA on ten expanded/collapsed fixture cards; mobile mode checks at 320/390px. It writes `public/tint-demo/measurements.json` and captures to `test/fixtures/generated/`.

The report measures every 4px lightness step along three horizontal/vertical paths, seam hue at 25/50/75%, chroma steps per 20px, corner brightness and text contrast across the reading area. Measurements and failed thresholds remain visible; they are not relabeled as passes. Current diagnostic-fixture reading contrast is at least 5.83:1 unread and 4.69:1 read. Corner lightness spread remains below .03 and images are confined to the header.

The saved report still includes strict full-photo 4px lightness, hue and chroma measurements from the pasted brief. Not all pass: original photographic/illustration edges and colors contribute to these measurements. These are reported limits, not a claim that the new clear-photo area meets those older gradient targets.

`test/helpers/card-photo-clarity.js` now checks the requested clear rectangle against the same rendered crop with all masks, soft layers and lift removed. Exact pixel equality is checked in Top, Classic and normal modes at 1440, 390 and 320px. The production fixture also accepts `IMAGE_FOCUS_FIXTURE` to repeat the checks using the photograph from the user's screenshot.

Latest verification: all 528 tests pass. Production browser checks pass for Top, Classic and normal cards at 320, 375, 390, 430, 844 and 1440px, including stable crops during Top/Classic expansion and collapse, panel isolation, read state and reduced motion. The running reader serves the composed HTML and client modules with successful HTTP responses.
