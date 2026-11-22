import sharp from 'sharp';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { extractSourceFrames } from './recording-media.mjs';

export async function writeEvidence({ video, output, events, frames, regions }) {
    const directory = `${output}/evidence`;
    await mkdir(directory, { recursive: true });
    // Bound evidence generation for long noisy captures; JSON retains every event.
    const indices = [...new Set(events.slice(0, 30).flatMap(e => [e.previousFrame, e.frame, e.returnFrame]))]
        .filter(i => frames[i]).sort((a, b) => a - b);
    await extractSourceFrames(video, indices, `${directory}/selection-%04d.png`);
    const tiles = [];
    for (const [position, index] of indices.entries()) {
        const raw = `${directory}/source-${index}.png`;
        await rename(`${directory}/selection-${String(position + 1).padStart(4, '0')}.png`, raw);
        const meta = await sharp(raw).metadata(), width = 480;
        const height = Math.round(meta.height * width / meta.width), scale = width / meta.width;
        const color = events.some(e => index >= e.frame && index <= e.lastFrame) ? '#ef4444' : '#16a34a';
        const rects = regions.map(r => `<rect x="${r.left * scale}" y="${r.top * scale}" width="${r.width * scale}" height="${r.height * scale}" fill="none" stroke="${r.role === 'backdrop' ? '#a855f7' : color}" stroke-width="2"/>`).join('');
        const label = `Frame ${index} | ${frames[index].time.toFixed(6)} s | ${frames[index].duration === null ? 'unknown duration' : (frames[index].duration * 1000).toFixed(3) + ' ms'}`;
        const image = await sharp(await readFile(raw)).resize(width, height).extend({ bottom: 36, background: '#111827' })
            .composite([{ input: Buffer.from(`<svg width="${width}" height="${height + 36}" xmlns="http://www.w3.org/2000/svg">${rects}<text x="8" y="${height + 23}" fill="white" font-family="sans-serif" font-size="12">${label}</text></svg>`) }]).png().toBuffer();
        await writeFile(`${directory}/annotated-${index}.png`, image);
        tiles.push({ input: image, left: (tiles.length % 3) * width, top: Math.floor(tiles.length / 3) * (height + 36) });
    }
    if (!tiles.length) return null;
    const first = await sharp(tiles[0].input).metadata();
    const contact = `${output}/contact-sheet.jpg`;
    await sharp({ create: { width: 1440, height: Math.ceil(tiles.length / 3) * first.height,
        channels: 3, background: '#111827' } }).composite(tiles).jpeg({ quality: 90 }).toFile(contact);
    return contact;
}
