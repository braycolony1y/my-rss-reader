# Ground News

Subscribe to `https://ground.news/` through the existing Add Source UI. The
registered Ground News source fetches that homepage directly on the backend;
no RSS intermediary, browser request, or headless browser is involved.

`src/sources/GroundNewsSource.js` decodes JSON arguments of `self.__next_f.push`,
joins split Flight chunks, reads JSON and length-prefixed UTF-8 text records,
resolves references with cycle/depth guards, and walks objects by story shape.
Publisher articles are retained inside a cluster, never emitted as feed items.
Duplicate event IDs and canonical URLs merge complementary metadata.

Items expose both the existing feed shape (`link`, `pubDate`, `content`,
`imageUrl`) and normalized `id`, `guid`, `url`, `publishedAt`, `description`,
`image`. `groundNews` retains coverage counts, publisher details, original
bias/blindspot fields, places, interests, sections, and media metadata.
Unavailable dates remain null in the normalized item; the existing storage
pipeline supplies its usual display date separately in `pubDate`.

The source implements the optional registry `fetchFeed` hook. Shared sync still
handles scheduling, manual refresh, logging, retention, and database writes.
A ten-minute memory cache also coalesces overlapping requests. Failures back off
for one minute and leave previously persisted articles intact. Requests have a
20-second timeout and a 15 MiB response limit. Errors contain a short diagnostic,
never the HTML. The regular JSON database serves page loads without refetching.

The current application consumes RSS but has no RSS/XML export generator. Ground
summaries therefore use the existing article content format without adding a new
export endpoint or coverage decoration to unrelated UI.

Verification on 2026-09-06: the saved live homepage fixture contains 38 unique
stories; 33 have publisher lists and bias/blindspot data. Three have no slug
(Ground's `/article/<event-id>` links work as fallback), and three have no image.
Publisher arrays are not guaranteed to enumerate every counted source. Optional
fields must not be interpreted as zero or as balanced coverage when absent.

Run `node --test test/ground-news-source.test.js` for parsing, normalization,
cache/error, and shared-sync persistence tests; `npm test` runs the full suite.
`test/fixtures/ground-live.html` is a real direct HTTP response captured during
implementation, replacing the unavailable attachment mentioned in the request.
