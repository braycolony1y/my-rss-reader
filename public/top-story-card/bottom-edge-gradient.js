import { rgbToOklab, gamutMap } from './blend/palette.js';

// Average a narrow edge strip in perceptual color space. Preserve its lightness
// and chroma; the CSS mask blends this continuation into the existing material.
export function bottomEdgeGradient(data, width, height, leftPercent, rightPercent) {
    const stops = [];
    const columns = 8;
    for (let column = 0; column < columns; column++) {
        const sum = [0, 0, 0];
        let weight = 0;
        for (let y = 0; y < height; y++) {
            for (let x = Math.floor(column * width / columns); x < Math.floor((column + 1) * width / columns); x++) {
                const i = (y * width + x) * 4;
                const alpha = data[i + 3] / 255;
                const lab = rgbToOklab(data[i], data[i + 1], data[i + 2]);
                lab.forEach((v, c) => sum[c] += v * alpha);
                weight += alpha;
            }
        }
        if (!weight) continue;
        const [L, a, b] = sum.map(v => v / weight);
        const H = (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
        const color = gamutMap(L, Math.hypot(a, b), H);
        const position = leftPercent + (rightPercent - leftPercent) * (column + .5) / columns;
        stops.push(`oklch(${color.L.toFixed(4)} ${color.C.toFixed(5)} ${H.toFixed(2)}) ${position.toFixed(3)}%`);
    }
    return stops.length ? `linear-gradient(to right in oklab, ${stops.join(', ')})` : null;
}
