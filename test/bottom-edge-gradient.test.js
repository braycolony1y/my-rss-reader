import test from 'node:test';
import assert from 'node:assert/strict';
import { bottomEdgeGradient } from '../public/top-story-card/bottom-edge-gradient.js';
import { rgbToOklab } from '../public/top-story-card/blend/palette.js';

test('bottom continuation preserves dark edge lightness and spatial colors', () => {
    const data = new Uint8ClampedArray(32 * 4 * 4);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 32; x++) {
        data.set(x < 16 ? [45, 28, 16, 255] : [20, 60, 100, 255], (y * 32 + x) * 4);
    }
    const gradient = bottomEdgeGradient(data, 32, 4, 48, 100);
    const colors = [...gradient.matchAll(/oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)/g)];
    assert.equal(colors.length, 8);
    assert.ok(Math.abs(Number(colors[0][1]) - rgbToOklab(45, 28, 16)[0]) < .0001);
    assert.ok(Math.abs(Number(colors[7][1]) - rgbToOklab(20, 60, 100)[0]) < .0001);
    assert.ok(Math.abs(Number(colors[0][3]) - Number(colors[7][3])) > 100);
    assert.equal(bottomEdgeGradient(new Uint8ClampedArray(data.length), 32, 4, 48, 100), null);
});
