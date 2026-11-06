// Fade only the photo's alpha into the existing spatial color field. The upper
// image, crop, card dimensions and all content keep their current presentation.
export const MOBILE_PHOTO_TRANSITION = Object.freeze({ start: .70, end: 1, steps: 24 });
const cache = new Map();
const MAX_MASK_SIZES = 24;

export function mobilePhotoBlendProgress(imageY) {
    const { start, end } = MOBILE_PHOTO_TRANSITION;
    const t = Math.max(0, Math.min(1, (imageY - start) / (end - start)));
    return t ** 3 * (t * (6 * t - 15) + 10);
}

export function directImageMask(width, height) {
    const key = `${width}/${height}`;
    if (cache.has(key)) return cache.get(key);
    const { start, end, steps } = MOBILE_PHOTO_TRANSITION;
    const stops = Array.from({ length: steps + 1 }, (_, i) => {
        const t = i / steps;
        // Zero slope at both ends keeps the beginning and end of the fade soft.
        const alpha = 1 - mobilePhotoBlendProgress(start + (end - start) * t);
        return `<stop offset="${(t * 100).toFixed(3)}%" stop-color="white" stop-opacity="${alpha.toFixed(5)}"/>`;
    }).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="fade" gradientUnits="userSpaceOnUse" x1="0" y1="${height * start}" x2="0" y2="${height * end}">${stops}</linearGradient></defs><rect width="${width}" height="${height}" fill="url(#fade)"/></svg>`;
    const value = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
    if (cache.size >= MAX_MASK_SIZES) cache.delete(cache.keys().next().value);
    cache.set(key, value);
    return value;
}
