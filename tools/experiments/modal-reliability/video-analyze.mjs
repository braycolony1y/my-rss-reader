import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { regionPixels, scoreFrame } from './usage-frames.mjs';

// Decode every source frame once. No frame-rate conversion or duplicated
// frames: timing is read from the source stream rather than assuming 60 fps.
export async function analyzeVideo({ video, visible, absent, regions, output }) {
    const open = await regionPixels(await readFile(visible), regions);
    const hidden = await regionPixels(await readFile(absent), regions);
    const { stdout } = await promisify(execFile)('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'frame=best_effort_timestamp_time,pkt_duration_time', '-of', 'json', video], { maxBuffer: 4e6 });
    const timing = JSON.parse(stdout).frames;
    const labels = regions.map((_, i) => `[s${i}]`).join('');
    const filter = `[0:v]split=${regions.length}${labels};` + regions.map((r, i) =>
        `[s${i}]crop=${r.width}:${r.height}:${r.left}:${r.top},scale=120:24,format=rgb24[r${i}]`).join(';')
        + ';' + regions.map((_, i) => `[r${i}]`).join('') + `vstack=inputs=${regions.length}[out]`;
    const ffmpeg = spawn('ffmpeg', ['-v', 'error', '-threads', '2', '-i', video, '-filter_complex', filter,
        '-map', '[out]', '-vsync', '0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']);
    const frameBytes = 120 * 24 * 3 * regions.length, regionBytes = frameBytes / regions.length;
    let pending = Buffer.alloc(0), index = 0, errorText = '';
    const frames = [];
    ffmpeg.stderr.on('data', chunk => { errorText += String(chunk); });
    const finished = new Promise((resolve, reject) => {
        ffmpeg.on('error', reject);
        ffmpeg.on('close', code => code === 0 ? resolve() : reject(Error(errorText)));
    });
    for await (const chunk of ffmpeg.stdout) {
        pending = Buffer.concat([pending, chunk]);
        while (pending.length >= frameBytes) {
            const pixels = regions.map((_, i) => pending.subarray(i * regionBytes, (i + 1) * regionBytes));
            frames.push({ index, time: Number(timing[index]?.best_effort_timestamp_time),
                duration: Number(timing[index]?.pkt_duration_time), ...scoreFrame(pixels, open, hidden) });
            pending = pending.subarray(frameBytes); index++;
        }
    }
    await finished;
    if (index !== timing.length || pending.length) throw Error('Decoded frame count does not match source timing');
    const report = { sourceFrames: index, regions, disappearances: frames.filter(f => f.disappearance), frames };
    await writeFile(output, JSON.stringify(report, null, 2));
    return report;
}

if (process.argv[1]?.endsWith('/video-analyze.mjs')) {
    const [video, visible, absent, output] = process.argv.slice(2);
    const report = await analyzeVideo({ video, visible, absent, output, regions: [
        { left: 450, top: 100, width: 1950, height: 130 },
        { left: 450, top: 1500, width: 1950, height: 100 },
        { left: 20, top: 300, width: 150, height: 500 }
    ] });
    console.log(JSON.stringify({ frames: report.sourceFrames, disappearances: report.disappearances }));
}
