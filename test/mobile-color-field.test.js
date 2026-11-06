import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileColorField } from '../public/top-story-card/mobile-color-field.js';
import { rgbToOklab } from '../public/card-blend/color-conversion.js';

const photo = (pixel) => Uint8ClampedArray.from(Array.from({ length: 32 * 32 }, (_, i) => pixel(i % 32, Math.floor(i / 32))).flat());
const labAt = (field, x, y) => rgbToOklab(...field.pixels.slice((y * field.width + x) * 4, (y * field.width + x) * 4 + 3));
test('image colors continue through the text area without a paper cap or a boundary jump', () => {
    const field = mobileColorField(photo(x => x < 16 ? [20, 90, 150, 255] : [180, 110, 25, 255]), 32, 32,
        { photoHeight: 200, cardHeight: 400 });
    const left = labAt(field, 1, 55), right = labAt(field, 14, 55);
    assert.ok(left[2] < -.03 && right[2] > .03, 'cool and warm image regions remain visible near the bottom');
    for (const x of [1, 8, 14]) {
        const before = labAt(field, x, 31), after = labAt(field, x, 32);
        assert.ok(Math.hypot(...before.map((v, i) => v - after[i])) < .025, 'no new color edge at the photo boundary');
        assert.ok(labAt(field, x, 34)[0] >= .85, 'the existing dark text retains a light reading surface');
        assert.ok(labAt(field, x, 60)[0] > labAt(field, x, 34)[0], 'lightness continues changing through the content instead of becoming a flat panel');
    }
});
test('dark illustrations get a continuous blue field and transparent images keep their fallback', () => {
    const geometry = { photoHeight: 200, cardHeight: 400 };
    const field = mobileColorField(photo(() => [12, 25, 55, 255]), 32, 32, geometry);
    assert.ok(labAt(field, 8, 45)[2] < -.015, 'the dark illustration keeps its blue identity below the image');
    assert.equal(mobileColorField(photo(() => [0, 0, 0, 0]), 32, 32, geometry), null);
});

test('the underlay starts lightening with the photo feather, rather than before it', () => {
    const color = [20, 70, 130, 255], sourceL = rgbToOklab(...color.slice(0, 3))[0];
    // Row 27 is exactly at imageY .85, the midpoint of the 70–100% feather.
    const geometry = { photoHeight: 200, cardHeight: .85 * 200 * 64 / 27.5 };
    const field = mobileColorField(photo(() => color), 32, 32, geometry);
    assert.ok(Math.abs(labAt(field, 8, 27)[0] - (sourceL + .865) / 2) < .005,
        'only half the tonal lift is present when half the photograph remains');
    assert.ok(Math.abs(labAt(field, 8, 20)[0] - sourceL) < .005,
        'the backdrop beneath the still-opaque image matches its original lightness');
});

test('colors above the feather do not replace the actual bottom-edge colors', () => {
    const field = mobileColorField(photo((x, y) => y < 25 ? [220, 70, 25, 255] : [20, 70, 180, 255]), 32, 32,
        { photoHeight: 200, cardHeight: 400 });
    const [, a, b] = labAt(field, 8, 55);
    const hue = (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
    assert.ok(hue > 240 && hue < 285, 'the blue lower edge continues into the reading surface without the red upper area');
});
