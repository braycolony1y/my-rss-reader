import test from 'node:test';
import assert from 'node:assert/strict';
import { edgeBleedPalette } from '../public/top-story-card/edge-bleed.js';

const pixels = (pixel) => Uint8ClampedArray.from(Array.from({ length: 32 * 32 }, (_, i) => pixel(i % 32, Math.floor(i / 32))).flat());
test('edge bleeding follows neighboring bottom and side colors independently', () => {
    const bottom = edgeBleedPalette(pixels((x, y) => y >= 27 ? (x < 16 ? [240, 40, 20, 255] : [20, 70, 240, 255]) : [40, 230, 20, 255]), 32, 32, 'bottom');
    const side = edgeBleedPalette(pixels((x, y) => x >= 4 && x <= 9 ? (y < 16 ? [240, 40, 20, 255] : [20, 70, 240, 255]) : [40, 230, 20, 255]), 32, 32, 'left');
    assert.ok(bottom.startsWith('linear-gradient(to right in oklab'));
    assert.ok(side.startsWith('linear-gradient(to bottom in oklab'));
    for (const gradient of [bottom, side]) {
        const colors = [...gradient.matchAll(/oklch\(([^)]+)\)/g)].map(match => match[1].split(' ').map(Number));
        assert.equal(colors.length, 6);
        assert.ok(colors[0][2] < 60 && colors[5][2] > 240, 'retain warm and cool edge regions in order');
        assert.ok(colors.every(([L, C]) => L >= .86 && L <= .96 && C <= .06), 'keep the text surface light');
    }
});
test('fully transparent edge pixels keep the existing background', () => {
    assert.equal(edgeBleedPalette(pixels(() => [0, 0, 0, 0]), 32, 32, 'bottom'), null);
});
