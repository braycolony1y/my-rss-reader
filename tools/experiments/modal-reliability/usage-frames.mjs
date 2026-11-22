import sharp from 'sharp';

export async function regionPixels(buffer, regions) {
    return Promise.all(regions.map(region => sharp(buffer).extract(region).resize(120, 24, { fit: 'fill' })
        .removeAlpha().raw().toBuffer()));
}

export function pixelDistance(a, b) {
    if (a.length !== b.length) throw Error('Frame region dimensions differ');
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
    return sum / a.length;
}

// Both fixed chrome regions must disappear together. Scrolling content is never
// included. Keep every score so thresholds can be independently inspected.
export function scoreFrame(pixels, visible, absent) {
    const scores = pixels.map((p, i) => ({ visible: pixelDistance(p, visible[i]), absent: pixelDistance(p, absent[i]) }));
    return { scores, disappearance: scores.every((s, i) =>
        s.visible > (i < 2 ? 12 : 3) && s.absent < s.visible * 0.65) };
}
