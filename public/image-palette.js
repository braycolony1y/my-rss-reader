// Sample broad color families, downweighting black/white so clothing and
// highlights do not drown out the thumbnail's environmental colors.
export function selectImagePalette(data, width, height, channels = 3) {
    function dominant(startRow, endRow = height) {
        const bins = new Map();
        const average = [0, 0, 0];
        let count = 0;
        for (let y = startRow; y < endRow; y += 2) {
            for (let x = 0; x < width; x += 2) {
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
                const weight = (chroma < 8 ? .08 : .25 + chroma / high * .5) * (1 + edge * 2);
                const key = chroma < 8 ? `neutral-${Math.floor(high / 32)}` : Math.floor((hue + 15) % 360 / 30);
                const bin = bins.get(key) || { weight: 0, rgb: [0, 0, 0] };
                bin.weight += weight;
                rgb.forEach((value, i) => { bin.rgb[i] += value * weight; });
                bins.set(key, bin);
            }
        }
        const best = [...bins.values()].sort((a, b) => b.weight - a.weight)[0];
        return best ? best.rgb.map(value => Math.round(value / best.weight))
            : count ? average.map(value => Math.round(value / count)) : [255, 255, 255];
    }
    // The upper scene usually contains the walls/foliage/sky being extended.
    // Sampling the whole foreground instead made this article's skin and
    // wooden table overpower its olive room colors.
    const backdrop = dominant(0, Math.max(1, Math.ceil(height * .4)));
    const primary = Math.max(...backdrop) - Math.min(...backdrop) >= 8 ? backdrop : dominant(0);
    const lower = dominant(0, Math.max(1, Math.ceil(height * .25)));
    const secondary = Math.max(...lower) - Math.min(...lower) < 8 ? primary : lower;
    return { primary, secondary };
}
