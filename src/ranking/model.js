// Loads the frozen model: linear heads (model.json) and section centroids (centroids.json).
//
// FROZEN: the centroids were precomputed once from the former AI "Top stories" labels
// (scripts/build-ranking-centroids.mjs) and are NOT refreshed by any running job. No AI
// writes to them any more. Rebuilding them is a deliberate, manual act.
import { readFileSync } from 'node:fs';

const read = name => JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));

/** Decode a base64 little-endian float32 vector. */
export function decodeVector(b64) {
  const buf = Buffer.from(String(b64), 'base64');
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}
export function encodeVector(vec) {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength).toString('base64');
}

/** @returns {Record<string,{top:Float32Array,excl:Float32Array}>|null} unit centroids per section plus 'all', or null if unavailable */
export function loadCentroids(file = './centroids.json') {
  try {
    const json = read(file);
    const out = {};
    for (const [key, value] of Object.entries(json.centroids || {})) out[key] = { top: decodeVector(value.top), excl: decodeVector(value.excl) };
    return out.all ? out : null;
  } catch { return null; }
}

let cached = null;
/** The shipped model with its centroids (memoised). */
export function loadModel() {
  if (!cached) cached = { ...read('./model.json'), centroids: loadCentroids() };
  return cached;
}
