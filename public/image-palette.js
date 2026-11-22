// Extend the background at the upper outer edges, not the central subject.
// Face bounds also exclude likely shoulders/clothing below every detected face.
// This is a background heuristic, not semantic segmentation of arbitrary objects.
export function selectImagePalette(data, width, height, channels = 3, faces = []) {
    function isSubject(x, y) {
        return faces.some(({ left, top, right, bottom }) => {
            const w = right - left, h = bottom - top;
            const padding = y > bottom ? w * 1.1 : w * .25;
            return y >= top - h * .5 && x >= left - padding && x <= right + padding;
        });
    }
    function dominant(startRow, endRow = height) {
        const bins = new Map();
        const average = [0, 0, 0];
        let count = 0;
        for (let y = startRow; y < endRow; y += 2) {
            for (let x = 0; x < width; x += 2) {
                const nx = x / Math.max(1, width - 1), ny = y / Math.max(1, height - 1);
                if (nx > .2 && nx < .8 || isSubject(nx, ny)) continue;
                const offset = (y * width + x) * channels;
                const rgb = [data[offset], data[offset + 1], data[offset + 2]];
                if (channels === 4 && data[offset + 3] < 128) continue;
                rgb.forEach((value, i) => { average[i] += value; });
                count++;
                const high = Math.max(...rgb), low = Math.min(...rgb);
                const chroma = high - low;
                if (high < 18 || low > 225) continue;
                // Pool related shades of the same hue. RGB cubes split foliage
                // into many small groups and let a single gray shirt win.
                let hue = chroma === 0 ? 0 : high === rgb[0] ? (rgb[1] - rgb[2]) / chroma
                    : high === rgb[1] ? 2 + (rgb[2] - rgb[0]) / chroma
                    : 4 + (rgb[0] - rgb[1]) / chroma;
                hue = (hue * 60 + 360) % 360;
                const edge = Math.abs(x / Math.max(1, width - 1) - .5) * 2;
                // A neutral wall is valid background; saturation must not let
                // a small colorful object overpower it after subject exclusion.
                const weight = (.75 + chroma / high * .25) * (1 + edge * 2);
                const key = chroma < 8 ? `neutral-${Math.floor(high / 32)}` : Math.floor((hue + 15) % 360 / 30);
                const bin = bins.get(key) || { weight: 0, rgb: [0, 0, 0] };
                bin.weight += weight;
                rgb.forEach((value, i) => { bin.rgb[i] += value * weight; });
                bins.set(key, bin);
            }
        }
        const best = [...bins.values()].sort((a, b) => b.weight - a.weight)[0];
        return best ? best.rgb.map(value => Math.round(value / best.weight))
            : count ? average.map(value => Math.round(value / count)) : [244, 251, 252];
    }
    // Never fall back to the full image: even a neutral wall is preferable to
    // a vivid shirt. Use the same background family across the whole card.
    const primary = dominant(0, Math.max(1, Math.ceil(height * .4)));
    return { primary, secondary: [...primary] };
}
