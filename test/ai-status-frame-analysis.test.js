import test from 'node:test';
import assert from 'node:assert/strict';
import { pixelDistance, scoreFrame } from '../tools/experiments/modal-reliability/usage-frames.mjs';

const region = value => Buffer.alloc(120 * 24 * 3, value);
const visible = [region(240), region(235), region(200)];
const absent = [region(130), region(100), region(180)];

test('paint analysis detects an immediate full-overlay disappearance/reappearance', () => {
    const sequence = [visible, absent, visible].map(p => scoreFrame(p, visible, absent));
    assert.deepEqual(sequence.map(s => s.disappearance), [false, true, false]);
});

test('paint analysis ignores small compression changes and isolated region changes', () => {
    assert.equal(scoreFrame([region(239), region(236), region(199)], visible, absent).disappearance, false);
    assert.equal(scoreFrame([absent[0], visible[1], absent[2]], visible, absent).disappearance, false);
    assert.equal(scoreFrame([absent[0], absent[1], visible[2]], visible, absent).disappearance, false,
        'a missing panel with a retained backdrop is not a full-overlay disappearance');
    assert.equal(pixelDistance(region(123), region(125)), 2);
});

test('paint analysis rejects incompatible region dimensions', () => {
    assert.throws(() => pixelDistance(Buffer.alloc(3), Buffer.alloc(4)), /dimensions differ/);
});
