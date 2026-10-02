import sharp from 'sharp';
const linear = value => (value /= 255) <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
export const luminance = rgb => .2126 * linear(rgb[0]) + .7152 * linear(rgb[1]) + .0722 * linear(rgb[2]);
export const decode = buffer => sharp(buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
export function textContrast(actual, surface, text) {
    const { width, height, channels } = surface.info;
    let minimum = Infinity, samples = 0;
    const foreground = luminance(text.color);
    for (let y = Math.max(0, Math.floor(text.y)); y < Math.min(height, Math.ceil(text.y + text.height)); y++)
        for (let x = Math.max(0, Math.floor(text.x)); x < Math.min(width, Math.ceil(text.x + text.width)); x++) {
            const i = (y * width + x) * channels;
            if (Math.max(...[0, 1, 2].map(c => Math.abs(actual.data[i + c] - surface.data[i + c]))) < 35) continue;
            const background = luminance(surface.data.subarray(i, i + 3));
            minimum = Math.min(minimum, (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05));
            samples++;
        }
    return { minimum: samples ? minimum : null, samples };
}
export function sampleSurface(surface) {
    const { width, height, channels } = surface.info;
    return [.15, .4, .6, .8, .95].map(nx => {
        const i = (Math.floor(height * .58) * width + Math.floor(width * nx)) * channels;
        return { x: nx, rgb: [...surface.data.subarray(i, i + 3)], luminance: luminance(surface.data.subarray(i, i + 3)) };
    });
}
