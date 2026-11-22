import { rgbToOklab, gamutMap } from '../card-blend/color-conversion.js';
import { mobilePhotoBlendProgress } from './mobile-photo-transition.js?v=20261106_4';

const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const t = clamp(value); return t * t * t * (t * (6 * t - 15) + 10); };
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// Continue the photograph's low-frequency colors through the whole card.
// The field matches the image inside the feather, then gradually gains the
// lightness needed by the existing text. There is no separate paper-colored cap.
export function mobileColorField(data, width, height, { photoHeight, cardHeight }) {
    if (!(photoHeight > 0 && cardHeight > 0)) return null;
    const size = 8, sums = Array.from({ length: size * size }, () => [0, 0, 0, 0]);
    const lab = [];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4, alpha = data[i + 3] / 255;
        const cell = sums[Math.floor(y * size / height) * size + Math.floor(x * size / width)];
        rgbToOklab(data[i], data[i + 1], data[i + 2], lab);
        for (let c = 0; c < 3; c++) cell[c] += lab[c] * alpha;
        cell[3] += alpha;
    }
    if (!sums.some(cell => cell[3])) return null;
    const source = sums.map(cell => cell[3] ? cell.slice(0, 3).map(v => v / cell[3]) : [.9, 0, 0]);
    const at = (x, y) => source[Math.max(0, Math.min(size - 1, y)) * size + Math.max(0, Math.min(size - 1, x))];
    const blurred = source.map((_, i) => {
        const color = [0, 0, 0];
        for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
            const weight = (x === 0 ? 2 : 1) * (y === 0 ? 2 : 1) / 16;
            at(i % size + x, Math.floor(i / size) + y).forEach((v, c) => color[c] += v * weight);
        }
        return color;
    });
    const sample = (nx, ny) => {
        const x = clamp(nx) * (size - 1), y = clamp(ny) * (size - 1), ix = Math.floor(x), iy = Math.floor(y);
        const get = (cx, cy) => blurred[Math.min(size - 1, cy) * size + Math.min(size - 1, cx)];
        return mix(mix(get(ix, iy), get(ix + 1, iy), x - ix), mix(get(ix, iy + 1), get(ix + 1, iy + 1), x - ix), y - iy);
    };
    const columns = 16, rows = 64, pixels = new Uint8ClampedArray(columns * rows * 4);
    const tails = Array.from({ length: columns }, (_, x) => sample((x + .5) / columns, 1));
    for (let x = 0; x < columns; x++) for (let y = 0; y < rows; y++) {
        const cardY = (y + .5) / rows * cardHeight, imageY = cardY / photoHeight;
        const tail = tails[x];
        const body = smooth((cardY - photoHeight) / Math.max(1, cardHeight - photoHeight));
        // Match the photo at the entry to the feather. An independently pale
        // underlay here reads as fog climbing over an otherwise opaque image.
        const lift = mobilePhotoBlendProgress(imageY);
        const raw = imageY < 1 ? sample((x + .5) / columns, imageY) : tail;
        const L = raw[0] + (.865 + .075 * body - raw[0]) * lift;
        const chroma = Math.hypot(raw[1], raw[2]);
        const C = Math.min(.09, chroma * (1 - .22 * lift - .16 * body));
        const hue = (Math.atan2(raw[2], raw[1]) * 180 / Math.PI + 360) % 360;
        const rgb = gamutMap(L, C, hue).rgb, i = (y * columns + x) * 4;
        pixels.set([...rgb, 255], i);
    }
    return { width: columns, height: rows, pixels };
}

export function mobileFieldBackground(canvas, data, width, height, geometry) {
    const field = mobileColorField(data, width, height, geometry);
    if (!field) return null;
    canvas.width = field.width; canvas.height = field.height;
    const context = canvas.getContext('2d'), image = context.createImageData(field.width, field.height);
    image.data.set(field.pixels); context.putImageData(image, 0, 0);
    return `url("${canvas.toDataURL('image/png')}") center / 100% 100% no-repeat`;
}
