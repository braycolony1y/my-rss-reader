import sharp from 'sharp';
import { clamp } from '../../../public/top-story-card/blend/palette.js';
export const smootherstep = t => (t = clamp(t, 0, 1), t ** 3 * (t * (t * 6 - 15) + 10));
const dataUrl = bytes => `data:image/webp;base64,${bytes.toString('base64')}`;

// Bake the expensive blur pyramid once. Every level uses the same decoded
// pixels and geometry; there is no misregistered second photograph at runtime.
export async function buildStoryBlendAssets(image, analysis, transparentSource = null) {
    const { data, info } = await image.clone().resize({ width: 1000, height: 1000, fit: 'inside', withoutEnlargement: true }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const base = sharp(data, { raw: { width: info.width, height: info.height, channels: 3 } });
    const widthScale = info.width / 600;
    const levels = [data];
    for (const sigma of analysis.busyness > 3000 ? [3, 10, 24, 36] : [3, 10, 24]) levels.push(await base.clone().blur(Math.max(.3, sigma * widthScale)).raw().toBuffer());
    const out = Buffer.alloc(info.width * info.height * 4);
    const f = analysis.focal;
    const leftEnd = Math.max(.04, Math.min(.40, f.x - f.w / 2 - .06));
    const bottomStart = Math.min(.93, Math.max(.55, f.y + f.h / 2 + .04));
    const busy = analysis.busyness > 3000;
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
        const nx = x / info.width, ny = y / info.height;
        const protectedSubject = nx >= f.x - f.w / 2 - .02 && nx <= f.x + f.w / 2 + .02 && ny >= f.y - f.h / 2 - .02 && ny <= f.y + f.h / 2 + .02;
        const melt = protectedSubject ? 0 : Math.max(1 - smootherstep(nx / leftEnd), smootherstep((ny - bottomStart) / (1 - bottomStart)));
        const level = clamp(melt * (busy ? 4 : 3), 0, levels.length - 1), low = Math.floor(level), high = Math.min(levels.length - 1, low + 1), weight = smootherstep(level - low);
        const source = (y * info.width + x) * 3, target = (y * info.width + x) * 4;
        for (let c = 0; c < 3; c++) out[target + c] = Math.round(levels[low][source + c] * (1 - weight) + levels[high][source + c] * weight);
        out[target + 3] = 255;
    }
    const hero = transparentSource
        ? await transparentSource.clone().resize({ width: 1000, height: 1000, fit: 'inside', withoutEnlargement: true }).webp({ quality: 87 }).toBuffer()
        : await sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } }).webp({ quality: 87 }).toBuffer();
    const ambient = await image.clone().resize(48, 32, { fit: 'fill' }).blur(1.5).webp({ quality: 78 }).toBuffer();
    return { heroImage: dataUrl(hero), ambientImage: dataUrl(ambient), bytes: { hero: hero.length, ambient: ambient.length } };
}
