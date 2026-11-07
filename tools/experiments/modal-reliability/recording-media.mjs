import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';

export const runMedia = promisify(execFile);

export async function requireMediaTools(run = runMedia) {
    for (const tool of ['ffmpeg', 'ffprobe']) try {
        await run(tool, ['-version']);
    } catch (error) {
        if (error.code === 'ENOENT') throw Error(`${tool} is missing. Install FFmpeg on macOS with "brew install ffmpeg", or on Ubuntu with "sudo apt install ffmpeg", then rerun this command.`);
        throw error;
    }
}

export async function probeRecording(video) {
    const { stdout, stderr } = await runMedia('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height,nb_frames,duration,start_time,time_base,avg_frame_rate,r_frame_rate:frame=pts_time,pkt_pts_time,best_effort_timestamp_time,pkt_duration_time,duration_time,decode_error_flags',
        '-of', 'json', video], { maxBuffer: 128 * 1024 * 1024 });
    if (stderr.trim()) throw Error(`Recording has decoder errors; no flickers will be classified: ${stderr.trim()}`);
    const data = JSON.parse(stdout), stream = data.streams?.[0];
    if (!stream || !data.frames?.length) throw Error('No decodable video frames found');
    const frames = data.frames.map((frame, index) => {
        const key = ['pts_time', 'pkt_pts_time'].find(k => frame[k] !== undefined);
        const time = Number(frame[key]);
        const duration = Number(frame.duration_time ?? frame.pkt_duration_time);
        if (!key || !Number.isFinite(time) || (frame.decode_error_flags && Number(frame.decode_error_flags)))
            throw Error(`Actual source PTS unavailable or decode error at frame ${index}; analysis stopped without inferred timing`);
        return { index, time, duration: Number.isFinite(duration) && duration > 0 ? duration : null, timestampSource: key };
    });
    for (let i = 1; i < frames.length; i++) if (frames[i].time <= frames[i - 1].time)
        throw Error(`Non-increasing presentation timestamps at frame ${i}; timing cannot be certified`);
    if (stream.nb_frames && stream.nb_frames !== 'N/A' && Number(stream.nb_frames) !== frames.length)
        throw Error(`Container declares ${stream.nb_frames} frames but ffprobe decoded ${frames.length}; refusing to classify missing frames as flickers`);
    return { stream, frames };
}

export async function extractSourceFrame(video, index, output) {
    await runMedia('ffmpeg', ['-v', 'error', '-xerror', '-noautorotate', '-i', video,
        '-vf', `select=eq(n\\,${index})`, '-vsync', '0', '-frames:v', '1', '-y', output]);
}

export async function extractSourceFrames(video, indices, pattern) {
    if (!indices.length) return;
    const expression = indices.map(index => `eq(n\\,${index})`).join('+');
    await runMedia('ffmpeg', ['-v', 'error', '-xerror', '-noautorotate', '-i', video,
        '-vf', `select=${expression}`, '-vsync', '0', '-enc_time_base', '-1', '-frames:v', String(indices.length), '-y', pattern]);
}

// One raw crop strip for each input frame, in presentation order. Never set -r.
export async function decodeRegions(video, regions, onFrame) {
    const labels = regions.map((_, i) => `[s${i}]`).join('');
    const filter = `[0:v]split=${regions.length}${labels};` + regions.map((r, i) =>
        `[s${i}]crop=${r.width}:${r.height}:${r.left}:${r.top},scale=120:24,format=rgb24[r${i}]`).join(';')
        + ';' + regions.map((_, i) => `[r${i}]`).join('') + `vstack=inputs=${regions.length}[out]`;
    const child = spawn('ffmpeg', ['-v', 'error', '-xerror', '-err_detect', 'explode', '-threads', '2',
        '-noautorotate', '-i', video, '-filter_complex', filter, '-map', '[out]', '-vsync', '0',
        '-enc_time_base', '-1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']);
    const regionBytes = 120 * 24 * 3, frameBytes = regionBytes * regions.length;
    let pending = Buffer.alloc(0), count = 0, stderr = '';
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-16000); });
    const finished = new Promise((resolve, reject) => {
        child.on('error', reject);
        child.on('close', code => code === 0 && !stderr.trim() ? resolve() : reject(Error(`Decode failed; no flickers classified: ${stderr}`)));
    });
    // Attach immediately so a spawn failure cannot become an unhandled rejection.
    finished.catch(() => {});
    try {
        for await (const chunk of child.stdout) {
            pending = Buffer.concat([pending, chunk]);
            while (pending.length >= frameBytes) {
                await onFrame(regions.map((_, i) => pending.subarray(i * regionBytes, (i + 1) * regionBytes)), count++);
                pending = pending.subarray(frameBytes);
            }
        }
        await finished;
        if (pending.length) throw Error('Incomplete raw frame; no flickers classified');
        return count;
    } catch (error) { child.kill(); await finished.catch(() => {}); throw error; }
}
