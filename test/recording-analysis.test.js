import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { captureMetrics, detectDropouts, scoreVisibleRegions } from '../tools/experiments/modal-reliability/recording-metrics.mjs';
import { requireMediaTools, runMedia } from '../tools/experiments/modal-reliability/recording-media.mjs';
import { selectRegions } from '../tools/experiments/modal-reliability/recording-regions.mjs';
import { regionPixels } from '../tools/experiments/modal-reliability/usage-frames.mjs';
import { analyzeRecording } from '../tools/experiments/modal-reliability/analyze-recording.mjs';
import { combineRecordingResults } from '../tools/experiments/modal-reliability/compare-recordings.mjs';

const regions = [
    { name: 'header', role: 'foreground', left: 0, top: 0, width: 32, height: 16 },
    { name: 'footer', role: 'foreground', left: 0, top: 48, width: 32, height: 16 },
    { name: 'backdrop', role: 'backdrop', left: 48, top: 16, width: 16, height: 32 }
];
const pixels = value => regions.map(() => Buffer.alloc(120 * 24 * 3, value));
const reference = pixels(240), absent = pixels(100);
const scores = p => scoreVisibleRegions(p, reference, regions);

test('missing media tools provide explicit installation instructions', async () => {
    await assert.rejects(requireMediaTools(async () => { const error = Error('missing'); error.code = 'ENOENT'; throw error; }), /ffmpeg is missing.*brew install ffmpeg.*apt install ffmpeg/);
    await assert.rejects(requireMediaTools(async tool => { if (tool === 'ffmpeg') return;
        const error = Error('missing'); error.code = 'ENOENT'; throw error; }), /ffprobe is missing/);
});

test('VFR metrics use source durations, preserve short events, and warn about capture gaps', () => {
    const frames = [
        { time: 0, duration: .008333 }, { time: .008333, duration: .025 },
        { time: .033333, duration: .008333 }, { time: .041666, duration: .008333 }
    ];
    const result = detectDropouts(frames, [scores(reference), scores(absent), scores(reference), scores(reference)]);
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].frame, 1);
    assert.equal(result.events[0].sourceDuration, .025);
    assert.equal(result.events[0].returnFrame, 2);
    const metrics = captureMetrics(frames);
    assert.ok(Math.abs(metrics.observedDuration - .049999) < 1e-8);
    assert.equal(metrics.maximumInterFrameGap, .025);
    assert.equal(metrics.sufficientFor8ms, false);
    assert.equal(metrics.frameDurations.histogramMilliseconds['8.333'], 3);
});

test('partial changes, persistent closing, and missing duration are not full transient dropouts', () => {
    const frames = Array.from({ length: 4 }, (_, i) => ({ time: i * .02, duration: .02 }));
    const partial = [absent[0], absent[1], reference[2]];
    assert.equal(detectDropouts(frames, [scores(reference), scores(partial), scores(reference), scores(reference)]).events.length, 0);
    const closing = detectDropouts(frames, [scores(reference), scores(reference), scores(absent), scores(absent)]);
    assert.equal(closing.events.length, 0); assert.equal(closing.unclassifiedChanges.length, 1);
    frames[1].duration = null;
    assert.equal(detectDropouts(frames, [scores(reference), scores(absent), scores(reference), scores(reference)]).events.length, 0);
    assert.equal(captureMetrics(frames).sufficientFor8ms, false);
});

test('a long VFR presentation is not certified as short from packet-duration metadata', () => {
    const frames = [{ time: 0, duration: .02 }, { time: .02, duration: .02 }, { time: 1.02, duration: .02 }];
    const result = detectDropouts(frames, [scores(reference), scores(absent), scores(reference)]);
    assert.equal(result.events.length, 0);
    assert.equal(result.unclassifiedChanges[0].presentationSpan, 1);
});

test('comparison weights independent exposure and refuses unknown timing or mixed layouts', () => {
    const report = (duration, count) => ({ configuration: 'baseline-ai', sourceStream: { width: 64, height: 64 },
        calibration: { regions }, events: Array.from({ length: count }, () => ({})),
        capture: { observedDuration: duration, finalDurationKnown: true, frames: 120, maximumInterFrameGap: .02, sufficientFor8ms: false } });
    const combined = combineRecordingResults([report(120, 1), report(240, 0)])[0];
    assert.equal(combined.duration, 360); assert.equal(combined.ratePerMinute, 1 / 6);
    const unknown = report(120, 0); unknown.capture.finalDurationKnown = false;
    assert.throws(() => combineRecordingResults([unknown]), /not a successful/);
    const other = report(120, 0); other.sourceStream.width = 100;
    assert.throws(() => combineRecordingResults([report(120, 0), other]), /Different calibrated layouts/);
});

test('reference crop resizing stretches the same full region as the decoder', async () => {
    const source = await sharp({ create: { width: 240, height: 24, channels: 3, background: '#ffffff' } })
        .composite([{ input: await sharp({ create: { width: 60, height: 24, channels: 3, background: '#000000' } }).png().toBuffer(), left: 0, top: 0 }]).png().toBuffer();
    const [result] = await regionPixels(source, [{ left: 0, top: 0, width: 240, height: 24 }]);
    // Default sharp "cover" would crop away the black strip entirely.
    assert.ok(result[0] < 5); assert.ok(result[(119 * 3)] > 250);
});

test('unknown layout needs calibration and rejects a mismatched viewport', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'recording-regions-'));
    try {
        const metadata = { stream: { width: 64, height: 64 }, frames: [{ time: 0, duration: .02 }] };
        assert.equal(await selectRegions({ video: path.join(directory, 'future.mp4'), metadata }), null);
        const configPath = path.join(directory, 'regions.json');
        await writeFile(configPath, JSON.stringify({ width: 100, height: 64, regions }));
        await assert.rejects(selectRegions({ video: 'unused', metadata, configPath }), /dimensions differ/);
    } finally { await rm(directory, { recursive: true, force: true }); }
});

test('real VFR decoding keeps every source frame; corrupt media cannot produce a flicker report', async t => {
    try { await requireMediaTools(); } catch (error) { if (/is missing/.test(error.message)) return t.skip(error.message); throw error; }
    const directory = await mkdtemp(path.join(tmpdir(), 'recording-decode-'));
    try {
        const video = path.join(directory, 'controlled.mp4'), output = path.join(directory, 'analysis');
        await runMedia('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=white:size=64x64:rate=120',
            '-vf', "drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill:enable='eq(n,1)',setpts='if(eq(N,0),0,if(eq(N,1),1,if(eq(N,2),4,5)))'",
            '-frames:v', '4', '-vsync', '0', '-c:v', 'libx264', '-bf', '0', '-video_track_timescale', '120000', video]);
        const configPath = path.join(directory, 'regions.json');
        await writeFile(configPath, JSON.stringify({ width: 64, height: 64, visibleFrame: 0, regions }));
        const report = await analyzeRecording(video, { output, configPath });
        assert.equal(report.capture.frames, 4);
        assert.equal(report.events.length, 1);
        assert.equal(report.events[0].frame, 1);
        assert.ok(report.capture.maximumInterFrameGap > .02);
        const corrupt = path.join(directory, 'corrupt.mp4');
        await writeFile(corrupt, (await readFile(video)).subarray(0, 80));
        const corruptOutput = path.join(directory, 'corrupt-analysis');
        await assert.rejects(analyzeRecording(corrupt, { output: corruptOutput, configPath }));
        assert.equal(JSON.parse(await readFile(path.join(corruptOutput, 'status.json'))).state, 'failed');
        await assert.rejects(readFile(path.join(corruptOutput, 'summary.json')), /ENOENT/);
    } finally { await rm(directory, { recursive: true, force: true }); }
});
