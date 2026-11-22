#!/usr/bin/env node
// Rebuild src/ranking/centroids.json: the section "AI-top" and "AI-excluded" e5 centroids.
//
// FROZEN ASSET. The shipped centroids were computed ONCE from the last AI "Top stories"
// publication (table topStoriesPublished) and the existing multilingual-e5-small cache. No job
// refreshes them any more; AI no longer participates in ranking. Run this script only
// deliberately, and only while those AI labels still exist (they are archived and later deleted; restore them first, see docs/ai-removal.md). It is read-only on the database and the embedding cache.
//
// Method (identical to the offline replay that tuned the ranker):
//   - assessed clusters of the live snapshot, each with its AI signals and member vectors;
//   - train = clusters whose latest material update is at or before the 70th percentile of
//     assessed cluster time (the "split"), minus the last 6 h, minus every cluster whose cosine to
//     a later (held-out) assessed cluster is >= 0.9, so the centroids carry no leakage;
//   - "top" = eligible, relevance >= 0.55 and freshness-free AI quality >= mean + 0.35 sd of its section;
//     "excluded" = not eligible or AI impact < 0.4; per section and over all sections;
//   - centroid = L2-normalised mean of cluster vectors.
//
// Usage: nice -n 19 node scripts/build-ranking-centroids.mjs [--db <reader.sqlite>] [--cache <smart-embeddings-worker.json>]
//                                                          [--out src/ranking/centroids.json] [--check] (compare with the shipped file, write nothing)
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadIncrementalEmbeddingSubset } from '../src/smart/embeddings/incremental-cache.js';
import { embeddingCacheKey } from '../src/smart/embeddings/index.js';
import { FEEDS, clusterVector, dot, unit } from '../src/ranking/features.js';
import { decodeVector, encodeVector } from '../src/ranking/model.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const DB = arg('--db', `${root}database_state/reader.sqlite`);
const CACHE = arg('--cache', `${root}smart-embeddings-worker.json`);
const OUT = arg('--out', `${root}src/ranking/centroids.json`);
const HOURS = 3600000, SPLIT_QUANTILE = 0.7, PURGE_HOURS = 6, DUP_COSINE = 0.9, TOP_KAPPA = 0.35;
const AI_WEIGHTS = { impact: 3.6, relevance: 1.2, novelty: 1.2, confidence: 1, attention: 0.3, independentCorroboration: 0.7 };
const AI_WEIGHT_SUM = Object.values(AI_WEIGHTS).reduce((a, b) => a + b, 0);

const db = new DatabaseSync(`file:${DB}?mode=ro`, { readOnly: true });
const members = new Map();
for (const r of db.prepare('select cluster_key k, payload p from cluster_members where collection=? order by cluster_key, position').all('$topStoriesPublished.articles')) {
  if (!members.has(r.k)) members.set(r.k, []); members.get(r.k).push(JSON.parse(r.p));
}
const clusters = [];
for (const r of db.prepare('select a.row_key k, a.payload p from articles a where a.collection=?').all('$topStoriesPublished.articles')) {
  const o = JSON.parse(r.p), story = o.topStory || {}, signals = o.ranking?.signals, assessed = o.editorialAssessment?.impact !== undefined;
  const articles = [o, ...(members.get(r.k) || [])];
  clusters.push({ id: o.clusterId, feed: story.feed, signals, assessed, latestMat: Number(story.latest_material_update) || 0, articles });
}
console.log('clusters', clusters.length, 'assessed', clusters.filter(c => c.assessed).length);

// e5 vectors of members (the exact cache the clustering uses).
const want = new Map();
for (const c of clusters) for (const a of c.articles) { a._key = embeddingCacheKey(a); want.set(a._key, null); }
await loadIncrementalEmbeddingSubset(CACHE, new Set(want.keys()), entries => {
  for (const [key, encoded] of Object.entries(entries)) want.set(key, unit(decodeVector(encoded)));
});
let withVec = 0;
for (const c of clusters) { c.vec = clusterVector(c.articles.map(a => want.get(a._key))); if (c.vec) withVec++; }
console.log('clusters with a vector', withVec);

// Time split, as in the replay: 70th percentile of assessed cluster time.
const T_FINAL = Number(db.prepare("select value from metadata_entries where collection='topStoriesPublished' and row_key='createdAt'").get()?.value);
const times = clusters.filter(c => c.assessed && c.latestMat > 1.79e12 && c.latestMat < T_FINAL + 1e8).map(c => c.latestMat).sort((a, b) => a - b);
const tSplit = times[Math.floor(times.length * SPLIT_QUANTILE)];
console.log('split', new Date(tSplit).toISOString());

const quality = c => Object.entries(AI_WEIGHTS).reduce((x, [k, w]) => x + w * c.signals[k], 0) / AI_WEIGHT_SUM * Math.max(0, Math.min(1, c.signals.relevance));
for (const c of clusters) c.eligible = c.assessed && c.signals.relevance > 0;

// Training set: before the split minus a purge gap, minus near duplicates of held-out clusters.
const assessedWithVec = clusters.filter(c => c.assessed && c.vec);
const heldOut = assessedWithVec.filter(c => c.latestMat > tSplit);
const duplicate = new Set();
for (const a of heldOut) for (const b of assessedWithVec) if (a !== b && dot(a.vec, b.vec) >= DUP_COSINE) duplicate.add(b.id);
const train = clusters.filter(c => c.latestMat <= tSplit - PURGE_HOURS * HOURS && !duplicate.has(c.id));

// Per-section freshness-free quality cut: mean + 0.35 sd over assessed train-period clusters (before the purge).
const cut = {};
for (const feed of FEEDS) {
  const q = train.filter(c => c.feed === feed && c.assessed).map(quality);
  const m = q.reduce((a, b) => a + b, 0) / (q.length || 1), sd = Math.sqrt(q.reduce((a, b) => a + (b - m) ** 2, 0) / (q.length || 1));
  cut[feed] = q.length ? m + TOP_KAPPA * sd : 1;
}
const dim = assessedWithVec[0].vec.length;
const acc = Object.fromEntries(['all', ...FEEDS].map(k => [k, { top: { sum: new Float64Array(dim), n: 0 }, excl: { sum: new Float64Array(dim), n: 0 } }]));
for (const c of train) {
  if (!c.assessed || !c.vec) continue;
  const cls = c.eligible && c.signals.relevance >= 0.55 && quality(c) >= cut[c.feed] ? 'top' : (!c.eligible || c.signals.impact < 0.4) ? 'excl' : null;
  if (!cls) continue;
  for (const slot of [acc[c.feed][cls], acc.all[cls]]) { for (let i = 0; i < dim; i++) slot.sum[i] += c.vec[i]; slot.n++; }
}
const centroids = {};
for (const [key, { top, excl }] of Object.entries(acc)) {
  centroids[key] = { top: encodeVector(unit(Float32Array.from(top.sum))), excl: encodeVector(unit(Float32Array.from(excl.sum))), nTop: top.n, nExcl: excl.n };
}
const result = {
  version: 'nonai-ranker-centroids-v1', frozen: true, model: 'Xenova/multilingual-e5-small', dim, split: new Date(tSplit).toISOString(),
  note: 'Frozen: precomputed once from the former AI Top-stories labels. No job refreshes these centroids.', centroids
};
if (process.argv.includes('--check')) {
  const shipped = JSON.parse(readFileSync(OUT, 'utf8')).centroids;
  for (const key of Object.keys(centroids)) {
    const a = decodeVector(centroids[key].top), b = decodeVector(shipped[key].top), c = decodeVector(centroids[key].excl), d = decodeVector(shipped[key].excl);
    console.log(key.padEnd(16), 'cos top', dot(a, b).toFixed(6), 'cos excl', dot(c, d).toFixed(6), 'n', centroids[key].nTop, '/', centroids[key].nExcl, 'shipped', shipped[key].nTop, '/', shipped[key].nExcl);
  }
} else { writeFileSync(OUT, JSON.stringify(result) + '\n'); console.log('wrote', OUT); }
