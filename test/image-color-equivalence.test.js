import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { areaLabGrid, normalizeAmbient, rgbToOklab, gamutMap } from '../public/card-blend/color.js';
import { normalizeMelt } from '../src/images/card-blend/melt.js';

const golden = JSON.parse(await readFile(new URL('./fixtures/image-colors-golden.json', import.meta.url), 'utf8'));
test('optimized color processing preserves pre-optimization RGB/RGBA output exactly', () => {
    for (const { channels, hash } of golden.fixtures) {
        const pixels = Buffer.alloc(73 * 41 * channels);
        for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 37 + (i >> 8) * 19) % 256;
        const grid = areaLabGrid(pixels, 73, 41, channels), ambient = normalizeAmbient(grid);
        const melt = normalizeMelt(pixels.subarray(0, 32 * 18 * 3), 32, 18, ambient.cells);
        assert.equal(createHash('sha256').update(JSON.stringify({ grid, ambient })).update(melt).digest('hex'), hash);
    }
    for (const { input, output } of golden.rgb) assert.deepEqual(rgbToOklab(...input), output);
    // JSON fixtures normalize -0, just as persisted/browser color metadata does.
    for (const { input, output } of golden.gamut) assert.deepEqual(JSON.parse(JSON.stringify(gamutMap(...input))), output);
});
