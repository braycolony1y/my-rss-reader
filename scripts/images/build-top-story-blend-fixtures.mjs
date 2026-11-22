import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import sharp from 'sharp';
import { analyzeThumbnail } from '../../src/images/top-story-blend/analyze.js';
const root = fileURLToPath(new URL('../../', import.meta.url));
const inputs = process.argv[2];
const capture = process.argv[3];
if (!inputs || !capture) throw new Error('Usage: node scripts/images/build-top-story-blend-fixtures.mjs samples.json baseline.json');
const samples = JSON.parse(await fs.readFile(inputs, 'utf8'));
const baseline = JSON.parse(await fs.readFile(capture, 'utf8'));
const fixtureDir = path.join(root, 'test/fixtures/top-story-blend');
const demoDir = path.join(root, 'public/top-story-card/demo');
await fs.mkdir(fixtureDir, { recursive: true });
await fs.mkdir(demoDir, { recursive: true });
const document = new JSDOM(baseline.html).window.document;
const card = document.querySelector('.article-card');
for (const node of card.querySelectorAll('template')) node.remove();
for (const node of [card, ...card.querySelectorAll('*')]) for (const attr of [...node.attributes]) {
    if (/^(x-|:|@)/.test(attr.name)) node.removeAttribute(attr.name);
}
card.removeAttribute('style');
const markup = card.outerHTML;
await fs.writeFile(path.join(fixtureDir, 'current-card.html'), markup);
const manifest = { version: 1, capturedCard: markup, samples: [] };
for (const sample of samples) {
    const bytes = await fs.readFile(path.join(path.dirname(inputs), sample.id + '.original'));
    const meta = await sharp(bytes).metadata();
    const filename = sample.id + '.' + meta.format;
    await fs.writeFile(path.join(fixtureDir, filename), bytes);
    const analysis = await analyzeThumbnail(bytes, { url: sample.image });
    await fs.writeFile(path.join(path.dirname(inputs), sample.id + '.analysis.json'), JSON.stringify(analysis));
    const entry = { id: sample.id, label: ['Wood portrait', 'Durians', 'Faces and flags', 'Tunnel construction', 'Expo crowd', 'Teal illustration'][manifest.samples.length],
        title: sample.title, excerpt: sample.content, articleUrl: sample.link, imageUrl: sample.image, filename, analysis };
    manifest.samples.push(entry);
}
await fs.writeFile(path.join(demoDir, 'manifest.json'), JSON.stringify(manifest));
const snapshots = manifest.samples.map(({ id, filename, imageUrl, analysis: a }) => ({ id, filename, imageUrl,
    avgL: a.avgL, meanChroma: a.meanChroma, hueCoherence: a.hueCoherence, hMean: a.hMean, busyness: a.busyness,
    crop: a.crop, graphic: a.graphic, accentH: a.tokens.accentH, faces: a.faces.length }));
await fs.writeFile(path.join(fixtureDir, 'measurements.json'), JSON.stringify(snapshots, null, 2));
console.log(JSON.stringify(snapshots.map(s => ({ id: s.id, hue: Math.round(s.hMean), accent: Math.round(s.accentH), crop: s.crop[0], faces: s.faces })), null, 2));
