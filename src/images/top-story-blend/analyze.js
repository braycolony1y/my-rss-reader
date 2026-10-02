import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { clusterPalette, laplacianVariance } from '../../../public/top-story-card/blend/palette.js';
import { deriveStoryTokens } from '../../../public/top-story-card/blend/tokens.js';
import { detectImageFrame } from './frames.js';
import { detectStorySubjects, storyFocalBox } from './subjects.js';
import { buildStoryBlendAssets } from './assets.js';
export const STORY_BLEND_VERSION = 1;
const pending = new Map();

export async function analyzeThumbnail(buffer, { url = '', detectFaces = detectStorySubjects, assets = true } = {}) {
    const contentHash = createHash('sha256').update(buffer).digest('hex');
    const key = `${url}:${contentHash}:${assets}`;
    if (detectFaces === detectStorySubjects && pending.has(key)) return pending.get(key);
    const job = (async () => {
        const source = sharp(buffer, { limitInputPixels: 40_000_000, animated: false }).rotate().toColourspace('srgb');
        const meta = await source.metadata();
        const normalized = await source.clone().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const { width: originalW, height: originalH } = normalized.info;
        const hasTransparency = normalized.data.some((v, i) => i % 4 === 3 && v < 250);
        const image = sharp(normalized.data, { raw: { width: originalW, height: originalH, channels: 4 } }).flatten({ background: { r: 244, g: 246, b: 250 } });
        const inspection = await image.clone().resize({ width: 768, withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const frame = detectImageFrame(inspection.data, inspection.info.width, inspection.info.height);
        const [l, t, r, b] = frame.crop;
        const left = Math.round(l * originalW), top = Math.round(t * originalH);
        const w = originalW - left - Math.round(r * originalW), h = originalH - top - Math.round(b * originalH);
        const cropped = image.clone().extract({ left, top, width: w, height: h });
        const working = await cropped.clone().resize({ width: 64 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        const palette = clusterPalette(working.data, working.info.width, working.info.height);
        const linear = v => (v /= 255) <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
        const luminanceMap = { w: working.info.width, h: working.info.height,
            values: Array.from({ length: working.info.width * working.info.height }, (_, i) => Math.round(255 *
                (.2126 * linear(working.data[i * 3]) + .7152 * linear(working.data[i * 3 + 1]) + .0722 * linear(working.data[i * 3 + 2])))) };
        const busy = await cropped.clone().resize({ width: 256 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        const graphic = frame.framed || frame.letterboxed || ['png', 'svg'].includes(meta.format) && hasTransparency;
        let faces = [];
        if (!graphic) { try { faces = await detectFaces(cropped); } catch { /* Saliency is the supported detector fallback. */ } }
        const focal = await storyFocalBox(cropped, faces);
        const result = { version: STORY_BLEND_VERSION, url, contentHash, originalW, originalH, w, h,
            crop: frame.crop, frame, graphic, hasTransparency, ...palette,
            busyness: laplacianVariance(busy.data, busy.info.width, busy.info.height), faces, focal, luminanceMap };
        result.tokens = deriveStoryTokens(result, { forceLight: false });
        if (assets) result.assets = await buildStoryBlendAssets(cropped, result, hasTransparency
            ? sharp(normalized.data, { raw: { width: originalW, height: originalH, channels: 4 } }).extract({ left, top, width: w, height: h }) : null);
        return result;
    })();
    if (detectFaces === detectStorySubjects) {
        pending.set(key, job);
        if (pending.size > 60) pending.delete(pending.keys().next().value);
        job.catch(() => pending.delete(key));
    }
    return job;
}
