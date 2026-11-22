import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import sharp from 'sharp';
import { analyzeThumbnail } from '../src/images/top-story-blend/analyze.js';
import { clusterPalette, hueDistance, gamutMap } from '../public/top-story-card/blend/palette.js';
import { deriveStoryTokens } from '../public/top-story-card/blend/tokens.js';
import { placeStoryHero, smootherstep } from '../public/top-story-card/blend/placement.js';
const directory = new URL('./fixtures/top-story-blend/', import.meta.url);
const snapshots = JSON.parse(await fs.readFile(new URL('measurements.json', directory), 'utf8'));
const analyzed = new Map();
async function sample(id) {
    if (!analyzed.has(id)) {
        const entry = snapshots.find(s => s.id === id);
        analyzed.set(id, analyzeThumbnail(await fs.readFile(new URL(entry.filename, directory)), { assets: false }));
    }
    return analyzed.get(id);
}

test('six reader thumbnails preserve their measured palette and texture families', async () => {
    for (const expected of snapshots) {
        const a = await sample(expected.id);
        assert.ok(Math.abs(a.avgL - expected.avgL) < .02, expected.id + ' OKLab lightness');
        assert.ok(Math.abs(a.hueCoherence - expected.hueCoherence) < .03, expected.id + ' hue coherence');
        assert.ok(Math.abs(a.busyness / expected.busyness - 1) < .10, expected.id + ' texture');
        assert.ok(hueDistance(a.hMean, expected.hMean) < 5);
        assert.equal(a.faces.length, expected.faces);
        assert.equal(deriveStoryTokens(a, { forceLight: false }).style, 'light', 'Medium-dark photos remain light by OKLab L');
        assert.equal(a.contentHash.length, 64);
    }
});

test('a small neon object cannot replace a population-weighted olive accent', () => {
    const data = new Uint8Array(64 * 40 * 3);
    for (let y = 0; y < 40; y++) for (let x = 0; x < 64; x++) data.set(x > 55 && y > 35 ? [14, 234, 106] : [147, 148, 47], (y * 64 + x) * 3);
    const palette = clusterPalette(data, 64, 40);
    const tokens = deriveStoryTokens({ ...palette, busyness: 0 });
    assert.ok(tokens.accentH > 95 && tokens.accentH < 115);
});

test('the illustrated border is cropped before statistics, without treating a flat photo as graphics', async () => {
    const photo = await sample('S1'), art = await sample('S6');
    assert.equal(photo.graphic, false); assert.ok(photo.crop.every(c => c === 0));
    assert.equal(art.graphic, true);
    assert.ok(art.frame.ridges.filter(r => r.detected).length >= 3, 'A frame needs three qualifying ridges; all four sides are cropped');
    assert.ok(art.crop.every(c => c > .04 && c < .08));
    assert.ok(art.tokens.accentH > 210 && art.tokens.accentH < 250);
    assert.equal(art.faces.length, 0);
});

test('aerial tunnel portals use saliency and the expo banners retain a purple accent', async () => {
    const tunnel = await sample('S4'), expo = await sample('S5');
    assert.equal(tunnel.focal.kind, 'saliency'); assert.equal(tunnel.faces.length, 0);
    assert.ok(hueDistance(tunnel.tokens.accentH, 57) < 15);
    assert.ok(hueDistance(expo.tokens.accentH, 303) < 15);
});

test('whole-scene fits preserve source proportions without a focal zoom or crop', async () => {
    for (const id of ['S1', 'S3', 'S5']) for (const width of [645, 740, 800, 1100]) {
        const a = await sample(id), p = placeStoryHero(a, { width, height: width / 1.57 });
        assert.equal(p.offsetX,width*.48,`${id}/${width}: approved left anchor`);
        assert.equal(p.imageW,width*.66,`${id}/${width}: independent photographic scale`);
        assert.ok(p.subject.right <= 1.141, `${id}/${width}: source bounds within intentional overflow`);
        assert.ok(p.subject.bottom < .56, `${id}/${width}: face above panel`);
        assert.equal(p.scale, 1, 'There is no extra focal zoom');
        assert.ok(Math.abs(p.imageW/p.imageH-a.w/a.h)<1e-9, 'Uniform scale preserves the ratio');
        assert.ok(p.offsetX >= 0 && p.offsetY >= 0, 'The entire source stays inside its wrapper');
        assert.ok(Math.abs(p.offsetX+p.imageW-width*1.14)<.001 && p.offsetY+p.imageH<=p.heroH+.001);
        assert.equal(p.maskV,'none','The composition module owns the organic envelope');
        assert.equal(p.mode, 'B');
    }
    assert.equal(placeStoryHero(await sample('S6'), { width: 740, height: 471 }).mode, 'G');
});

test('stacked cards reserve the original photo height and preserve source registration', async () => {
    for (const id of ['S1', 'S3', 'S5', 'S6']) for (const width of [340, 560]) {
        const p = placeStoryHero(await sample(id), { width, height: 1000 });
        assert.equal(p.placement, 'stacked'); assert.equal(p.heroH, width * 9 / 16);
        assert.ok(p.imageW <= width); assert.ok(p.imageH <= p.heroH);
        assert.ok(p.offsetX >= 0 && p.offsetY >= 0);
        assert.ok(p.offsetX+p.imageW<=width+.001 && p.offsetY+p.imageH<=p.heroH+.001);
        assert.equal(p.scale,1); assert.ok(Math.abs(p.imageW/p.imageH-(await sample(id)).w/(await sample(id)).h)<1e-9);
    }
    let previous = 0;
    for (let i = 0; i <= 100; i++) { const v = smootherstep(i / 100); assert.ok(v >= previous); previous = v; }
    assert.equal(smootherstep(0), 0); assert.equal(smootherstep(1), 1);
});

test('a tiny thumbnail is enlarged only by the contain fit, while a high face avoids mobile avatars without clipping', () => {
    const small = {w:80,h:45,focal:{x:.5,y:.4,w:.18,h:.18,kind:'default'}};
    const p = placeStoryHero(small,{width:340,height:800,avatar:{left:.8,right:1,top:0,bottom:.04}});
    assert.equal(p.scale,1); assert.equal(p.fitScale,340/80); assert.equal(p.imageH,340*9/16);
    const high = placeStoryHero({...small,w:800,h:450,focal:{x:.85,y:.08,w:.16,h:.16,kind:'face'}},
        {width:340,height:800,avatar:{left:.60,right:1,top:.02,bottom:.07}});
    assert.ok(high.subject.top >= .07); assert.ok(high.offsetY+high.imageH<=high.heroH+.001);
    assert.ok(Math.abs(high.imageW/high.imageH-800/450)<1e-9); assert.equal(high.scale,1);
});

test('all dark tokens flip together, and generated colors fit sRGB', async () => {
    const a = await sample('S6'), dark = deriveStoryTokens({ ...a, avgL: .3 }, { forceLight: false });
    assert.equal(dark.style, 'dark');
    assert.match(dark.css['--ink'], /0\.9700/); assert.match(dark.css['--panel-tint'], /0\.2400/);
    assert.equal(deriveStoryTokens({ ...a, avgL: .3 }, { forceLight: true }).style, 'light');
    for (const h of [0, 60, 110, 220, 300]) {
        const c = gamutMap(.975, .1, h);
        assert.ok(c.rgb.every(n => n >= 0 && n <= 255)); assert.ok(c.C <= .1);
    }
});

test('transparent artwork retains alpha while using the common desktop framing', async () => {
    const pixels = Buffer.alloc(64 * 64 * 4);
    for (let y = 16; y < 48; y++) for (let x = 16; x < 48; x++) pixels.set([30, 110, 190, 255], (y * 64 + x) * 4);
    const bytes = await sharp(pixels, { raw: { width: 64, height: 64, channels: 4 } }).png().toBuffer();
    const a = await analyzeThumbnail(bytes);
    assert.equal(a.graphic, true); assert.equal(a.hasTransparency, true);
    const hero = Buffer.from(a.assets.heroImage.split(',')[1], 'base64');
    assert.equal((await sharp(hero).metadata()).hasAlpha, true);
    const p = placeStoryHero(a, { width: 740, height: 471 });
    assert.equal(p.placement, 'editorial'); assert.equal(p.mode, 'G');
    assert.equal(p.offsetX, 740 * .48); assert.equal(p.imageW, 740 * .66);
    assert.equal(p.posX, a.focal.x * 100); assert.equal(p.posY, a.focal.y * 100);
});
