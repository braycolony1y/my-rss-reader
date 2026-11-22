// Spectral residual on a 64px grayscale image, independent of image format or
// source. Excluding the outer margin stops corner captions driving placement.
function fft(re, im, inverse = false) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
    }
    for (let size = 2; size <= n; size *= 2) {
        const angle = (inverse ? 2 : -2) * Math.PI / size;
        for (let start = 0; start < n; start += size) for (let j = 0; j < size / 2; j++) {
            const a = start + j, b = a + size / 2;
            const c = Math.cos(angle * j), s = Math.sin(angle * j);
            const r = re[b] * c - im[b] * s, i = re[b] * s + im[b] * c;
            re[b] = re[a] - r; im[b] = im[a] - i; re[a] += r; im[a] += i;
        }
    }
    if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}
function transform(re, im, n, inverse = false) {
    for (let y = 0; y < n; y++) {
        const r = re.slice(y * n, (y + 1) * n), i = im.slice(y * n, (y + 1) * n);
        fft(r, i, inverse); re.set(r, y * n); im.set(i, y * n);
    }
    for (let x = 0; x < n; x++) {
        const r = Float64Array.from({ length: n }, (_, y) => re[y * n + x]);
        const i = Float64Array.from({ length: n }, (_, y) => im[y * n + x]);
        fft(r, i, inverse);
        for (let y = 0; y < n; y++) { re[y * n + x] = r[y]; im[y * n + x] = i[y]; }
    }
}
export function spectralFocalPoint(data, n = 64, channels = 3) {
    const re = Float64Array.from({ length: n * n }, (_, i) => (.299 * data[i * channels] + .587 * data[i * channels + 1] + .114 * data[i * channels + 2]) / 255);
    const im = new Float64Array(n * n);
    transform(re, im, n);
    const amplitude = re.map((r, i) => Math.log(Math.max(1e-8, Math.hypot(r, im[i]))));
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        let average = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) average += amplitude[((y + dy + n) % n) * n + (x + dx + n) % n] / 9;
        const i = y * n + x, phase = Math.atan2(im[i], re[i]), residual = Math.exp(amplitude[i] - average);
        re[i] = residual * Math.cos(phase); im[i] = residual * Math.sin(phase);
    }
    transform(re, im, n, true);
    let weight = 0, sx = 0, sy = 0;
    const margin = Math.ceil(n * .08);
    for (let y = margin; y < n - margin; y++) for (let x = margin; x < n - margin; x++) {
        const i = y * n + x, w = re[i] ** 2 + im[i] ** 2;
        weight += w; sx += (x + .5) / n * w; sy += (y + .5) / n * w;
    }
    return weight > 1e-10 ? { x: sx / weight, y: sy / weight } : { x: .5, y: .4 };
}
