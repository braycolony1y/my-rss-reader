# Responsive article image cropping

Article thumbnails use a dedicated image viewport on the right of each card.
`public/image-focus.js` requests `GET /api/image-focus?src=...` as soon as each
card is rendered, before its lazy image loads. Images within 1600 pixels of
the viewport are preloaded. Successful results are reused from session storage
on repeat visits. A photo fades in only once its dimensions and crop are ready,
so a centre crop does not flash before the focal crop.
It recalculates `object-position` from natural image dimensions and the actual
image viewport whenever that viewport changes, including iPhone rotation,
window resizing, and expanded card content. Text/reader images are unaffected.

Smart Top cards explicitly mark `data-image-layout="top"`. Their photo viewport
ends at the heading or just above the first visible facts/analysis/notice panel,
whichever comes first. Resizing the heading or changing panel visibility updates
this boundary; expanding the analysis body cannot stretch the photo behind it.
An unusually large face that cannot fit a cover crop uses contain instead.

A 2.5-second nearby-image deadline reveals a centre fallback on slow/offline
detection. If detection arrives after that fallback is already visible, the
current crop stays fixed until it leaves the viewport. The result is saved for
the next view. A head bootstrap prevents a flash before the module starts, and
automatically restores ordinary images if that module fails to start. Without
JavaScript, images remain visible normally.

The server downloads a bounded image through the existing image proxy, then
uses the bundled UltraFace CPU model to find faces. Larger confident faces win;
centrality only breaks close scores. The selected face rectangle lets the browser
retain the entire face with padding when it fits. When no face is found, libvips
attention selects a salient location; near-uniform images fall back to centre.
This is face detection and visual saliency, not general object recognition.
It makes no generative AI requests and does not identify people.
ONNX Runtime telemetry is disabled before initializing the detector.

Results are stored by image URL and detector version under
`article_cache/image-focus/`, and reused across articles, visits, and devices.
The browser deduplicates requests, starts at most two at once, and ignores stale
results after image fallback or card replacement. The server serializes inference,
bounds its pending queue and memory cache, caps downloads at 8 MB / 12 seconds,
and caps decoded images at 40 million pixels. Failed requests use centre cropping
and are retried on a later visit rather than saved permanently. Local/default
images skip detection. CPU inference runs once per new image requested by a
rendered card, rather than analysing the entire feed archive at ingestion.

The cover calculation never translates the element beyond its box. It aims
the subject toward the clear right side and constrains
the crop to retain its face bounds where geometrically possible. Very large
subjects, multiple widely separated people, and extreme aspect ratios cannot
always fit in a cover crop; the primary face takes priority, with contain as a
fallback when its rectangle exceeds the available space.

Model provenance and licence are in `src/images/models/`.

Verification: `npm test` includes crop geometry, real model initialization,
saliency, persistent-cache/deduplication, failure handling, route authentication,
early detection, session reuse, late-result stability, and stale browser response
checks. `node test/helpers/image-focus-browser.mjs`
additionally checks all three card modes in Chromium at widths from 320 to 1440
pixels, including resizing back to desktop, expanding a real analysis panel,
and delaying detection until after the photo loads. It saves previews under
`/tmp`. Optional `IMAGE_FOCUS_FIXTURE=/tmp/prefix` uses a local `.avif` photo and
`.json` focal result to verify a specific image without network requests.
