import { rgbToOklab, gamutMap, hueOf, hueDistance, clamp } from '../../card-blend/color.js';
export { rgbToOklab, gamutMap, hueOf, hueDistance, clamp };

// Deterministic farthest-point seeds keep small saturated objects from defining
// the palette. Populations, rather than individual pixels, choose the accent.
export function clusterPalette(data, width, height, channels = 3) {
    const pixels = [];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const i = (y * width + x) * channels;
        if (channels === 4 && data[i + 3] < 128) continue;
        const lab = rgbToOklab(data[i], data[i + 1], data[i + 2]);
        pixels.push({ lab, x: (x + .5) / width, y: (y + .5) / height, rgb: Array.from(data.slice(i, i + 3)) });
    }
    if (!pixels.length) return null;
    const interior = pixels.filter(p => p.x > .04 && p.x < .96 && p.y > .04 && p.y < .96);
    const points = interior.length ? interior : pixels;
    const distance = (a, b) => a.reduce((s, v, i) => s + (i === 0 ? .25 : 1) * (v - b[i]) ** 2, 0);
    const sorted = [...points].sort((a, b) => a.lab[0] - b.lab[0]);
    let centers = [sorted[Math.floor(sorted.length / 2)].lab];
    for (let k = 1; k < 6; k++) {
        const next = points.reduce((best, p) => {
            const d = Math.min(...centers.map(c => distance(p.lab, c)));
            return d > best.d ? { d, lab: p.lab } : best;
        }, { d: -1, lab: centers[0] });
        centers.push([...next.lab]);
    }
    const nearest = lab => centers.reduce((best, c, i) => distance(lab, c) < distance(lab, centers[best]) ? i : best, 0);
    for (let pass = 0; pass < 18; pass++) {
        const sums = centers.map(() => [0, 0, 0, 0]);
        for (const p of points) { const s = sums[nearest(p.lab)]; p.lab.forEach((v, i) => s[i] += v); s[3]++; }
        const next = sums.map((s, i) => s[3] ? s.slice(0, 3).map(v => v / s[3]) : centers[i]);
        const movement = next.reduce((s, c, i) => s + distance(c, centers[i]), 0);
        centers = next;
        if (movement < 1e-8) break;
    }
    const groups = centers.map(() => []);
    points.forEach(p => groups[nearest(p.lab)].push(p));
    const clusters = centers.map(([L, a, b], i) => ({ L, C: Math.hypot(a, b), H: hueOf(a, b),
        pop: groups[i].length / points.length,
        x: groups[i].reduce((s, p) => s + p.x, 0) / (groups[i].length || 1),
        y: groups[i].reduce((s, p) => s + p.y, 0) / (groups[i].length || 1), index: i })).filter(c => c.pop);
    const band = predicate => {
        const group = pixels.filter(predicate), counts = centers.map(() => 0);
        group.forEach(p => counts[nearest(p.lab)]++);
        const ordered = [...clusters].sort((a, b) => counts[b.index] - counts[a.index]);
        const best = ordered[0], color = ordered.find(c => c.C >= .04);
        return { L: best.L, C: best.C, H: color?.H ?? best.H };
    };
    const rgb = pixels.reduce((s, p) => s.map((v, i) => v + p.rgb[i] / pixels.length), [0, 0, 0]);
    const totalChroma = pixels.reduce((s, p) => s + Math.hypot(p.lab[1], p.lab[2]), 0);
    const [a, b] = pixels.reduce((s, p) => [s[0] + p.lab[1], s[1] + p.lab[2]], [0, 0]);
    const hMean = totalChroma ? hueOf(a, b) : 60;
    const hueCoherence = totalChroma ? pixels.reduce((s, p) => s +
        (hueDistance(hueOf(p.lab[1], p.lab[2]), hMean) <= 40 ? Math.hypot(p.lab[1], p.lab[2]) : 0), 0) / totalChroma : 1;
    const lightness = pixels.map(p => p.lab[0]).sort((a, b) => a - b);
    return { avgL: rgbToOklab(...rgb)[0], meanChroma: totalChroma / pixels.length, hMean, hueCoherence,
        lumRange: [.05, .95].map(p => lightness[Math.floor((lightness.length - 1) * p)]),
        clusters: clusters.map(({ index, ...c }) => c).sort((a, b) => b.pop - a.pop),
        leftBand: band(p => p.x < .4), bottomBand: band(p => p.y > .7) };
}

export function laplacianVariance(data, width, height, channels = 3) {
    const gray = Array.from({ length: width * height }, (_, p) =>
        .299 * data[p * channels] + .587 * data[p * channels + 1] + .114 * data[p * channels + 2]);
    let sum = 0, squares = 0, count = 0;
    for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        const v = gray[i - 1] + gray[i + 1] + gray[i - width] + gray[i + width] - 4 * gray[i];
        sum += v; squares += v * v; count++;
    }
    return count ? squares / count - (sum / count) ** 2 : 0;
}
