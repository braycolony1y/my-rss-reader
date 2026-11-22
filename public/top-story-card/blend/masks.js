import { clamp } from './palette.js';
export const smootherstep = t => (t = clamp(t, 0, 1), t ** 3 * (t * (t * 6 - 15) + 10));
export function smoothMask(direction, start, end, inverse = false) {
    const stops = Array.from({ length: 17 }, (_, i) => {
        const t = i / 16;
        return `rgb(0 0 0 / ${(inverse ? 1 - smootherstep(t) : smootherstep(t)).toFixed(4)}) ${((start + (end - start) * t) * 100).toFixed(3)}%`;
    });
    return `linear-gradient(to ${direction}, ${stops.join(', ')})`;
}
