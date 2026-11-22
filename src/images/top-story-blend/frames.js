import { clamp } from '../../../public/top-story-card/blend/palette.js';

// Inspect central profiles so text and agency marks in the corners cannot
// trigger a crop. Only repeated border ridges or uniform letterboxes qualify.
export function detectImageFrame(data, width, height, channels = 4) {
    const luma = (x, y) => {
        const i = (y * width + x) * channels;
        return .2126 * data[i] + .7152 * data[i + 1] + .0722 * data[i + 2];
    };
    const profile = side => {
        const horizontal = side === 'top' || side === 'bottom', length = horizontal ? height : width;
        const across = horizontal ? width : height;
        return Array.from({ length: Math.ceil(length * .10) + 2 }, (_, n) => {
            const depth = side === 'bottom' || side === 'right' ? length - 1 - n : n;
            const values = [];
            for (let k = Math.floor(across * .3); k < Math.ceil(across * .7); k++) values.push(horizontal ? luma(k, depth) : luma(depth, k));
            const mean = values.reduce((s, v) => s + v, 0) / values.length;
            return { mean, std: Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length) };
        });
    };
    const sides = ['left', 'top', 'right', 'bottom'];
    const ridges = sides.map(side => {
        const p = profile(side), length = side === 'top' || side === 'bottom' ? height : width;
        let best = { inset: 0, strength: 0 };
        for (let n = Math.max(1, Math.ceil(length * .01)); n <= Math.floor(length * .06); n++) {
            const radius = Math.max(1, Math.round(length * .01));
            const values = p.slice(Math.max(0, n - radius), Math.min(p.length, n + radius + 1)).map(v => v.mean);
            const strength = Math.max(...values) - Math.min(...values);
            if (strength > best.strength) best = { inset: n / length, strength };
        }
        const letterbox = p[0].std < 2 && Math.abs(p[0].mean - p[Math.ceil(length * .02)]?.mean) > .08 * 255;
        let letterInset = 0;
        if (letterbox) while (letterInset + 1 < p.length && p[letterInset].std < 2 && Math.abs(p[letterInset].mean - p[0].mean) < 4) letterInset++;
        return { side, ...best, detected: best.strength >= 60, letterbox, letterInset: letterInset / length };
    });
    const framed = ridges.filter(r => r.detected).length >= 3;
    const inset = framed ? clamp(Math.max(...ridges.filter(r => r.detected).map(r => r.inset)) + .025, 0, .10) : 0;
    return { crop: ridges.map(r => framed ? inset : r.letterbox ? r.letterInset : 0), framed,
        letterboxed: ridges.some(r => r.letterbox), ridges };
}
