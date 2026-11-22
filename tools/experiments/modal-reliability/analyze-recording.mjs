import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { requireMediaTools, probeRecording, extractSourceFrame, decodeRegions } from './recording-media.mjs';
import { selectRegions, regionPicker } from './recording-regions.mjs';
import { regionPixels } from './usage-frames.mjs';
import { captureMetrics, scoreVisibleRegions, detectDropouts, resultRow } from './recording-metrics.mjs';
import { writeEvidence } from './recording-evidence.mjs';

async function analyzeVerifiedRecording(video, { output, configPath, setup = false, configuration } = {}) {
    const sourceIdentity = await stat(video);
    const metadata = await probeRecording(video);
    const config = setup ? null : await selectRegions({ video, metadata, configPath });
    if (!config) {
        const first = `${output}/first-frame.png`;
        await extractSourceFrame(video, 0, first);
        const picker = `${output}/region-picker.html`;
        await writeFile(picker, regionPicker((await readFile(first)).toString('base64'), metadata));
        return { calibrationRequired: true, picker,
            instructions: `Open ${picker}, select two fixed foreground regions and one backdrop region, then save the downloaded configuration beside the recording as ${path.basename(video)}.regions.json and rerun the same command. The recording must begin with the modal fully open.` };
    }
    const referencePath = `${output}/visible-reference.png`;
    await extractSourceFrame(video, config.visibleFrame, referencePath);
    const reference = await regionPixels(await readFile(referencePath), config.regions);
    const scores = [];
    const decoded = await decodeRegions(video, config.regions, (pixels, index) => {
        if (!metadata.frames[index]) throw Error('Decoder produced extra frames; refusing to classify');
        scores.push(scoreVisibleRegions(pixels, reference, config.regions));
    });
    if (decoded !== metadata.frames.length) throw Error(`Decoded ${decoded} frames versus ${metadata.frames.length} source timestamps; no flickers classified`);
    const capture = captureMetrics(metadata.frames), detection = detectDropouts(metadata.frames, scores, config);
    const report = { configuration: configuration || path.basename(video), video: path.resolve(video),
        sourceIdentity: { bytes: sourceIdentity.size, modifiedAt: sourceIdentity.mtimeMs },
        sourceStream: metadata.stream, calibration: config, capture, ...detection,
        ratePerMinute: capture.finalDurationKnown && capture.observedDuration > 0 ? detection.events.length * 60 / capture.observedDuration : null,
        classification: 'Visual multi-region transient candidates; review annotated frames. This cannot identify DOM, compositor, or capture-only causality.',
        frames: metadata.frames.map((f, i) => ({ ...f, scores: scores[i] })) };
    report.contactSheet = await writeEvidence({ video, output, events: report.events, frames: report.frames, regions: config.regions });
    const after = await stat(video);
    if (after.size !== sourceIdentity.size || after.mtimeMs !== sourceIdentity.mtimeMs) throw Error('Source recording changed during analysis; no flickers certified');
    await writeFile(`${output}/summary.json`, JSON.stringify(report, null, 2));
    const lines = [
        '# Recording analysis', '', `Source: ${path.basename(video)}`, '',
        '| Configuration | Duration | Captured frames | Maximum gap | Dropouts | Rate/min |',
        '| --- | --- | --- | --- | --- | --- |', resultRow(report), '',
        ...report.events.map(e => `- Frame ${e.frame}: ${e.timestamp.toFixed(6)} s; source duration ${(e.sourceDuration * 1000).toFixed(3)} ms; return frame ${e.returnFrame}.`), '',
        `Intervals between events: ${report.intervalsBetweenEvents.map(s => s.toFixed(6) + ' s').join(', ') || 'none'}.`,
        `Effective captured rate: ${capture.effectiveFps?.toFixed(3) ?? 'unknown'} fps${capture.observedDurationIsLowerBound ? ' (exposure is a lower bound; final source duration missing)' : ''}. Frame durations (ms): ${JSON.stringify(capture.frameDurations.histogramMilliseconds)}.`, '',
        ...(!capture.sufficientFor8ms ? ['**WARNING: Capture coverage is insufficient to exclude an approximately 8 ms event. Zero detections do not establish absence.**', ''] : []),
        capture.warning, '', report.classification, '',
        report.unclassifiedChanges.length ? `${report.unclassifiedChanges.length} unbracketed/prolonged changes require review; see JSON.` : 'No unbracketed/prolonged full-region changes.', '',
        report.contactSheet ? '[Annotated contact sheet](contact-sheet.jpg)' : 'No transient candidates for a contact sheet.'
    ];
    await writeFile(`${output}/report.md`, lines.join('\n') + '\n');
    return report;
}

export async function analyzeRecording(video, options = {}) {
    const output = options.output || `${video}.analysis`, startedAt = new Date().toISOString();
    await mkdir(output, { recursive: true });
    const status = state => JSON.stringify({ state, startedAt, source: path.resolve(video) }, null, 2);
    await writeFile(`${output}/status.json`, status('running'));
    try {
        await requireMediaTools();
        const result = await analyzeVerifiedRecording(video, { ...options, output });
        await writeFile(`${output}/status.json`, status(result.calibrationRequired ? 'calibration-required' : 'complete'));
        return result;
    } catch (error) {
        await writeFile(`${output}/status.json`, JSON.stringify({ state: 'failed', startedAt, source: path.resolve(video), error: error.message }, null, 2));
        throw error;
    }
}

async function main(args) {
    if (!args.length || args.includes('--help')) {
        console.log('Usage: node tools/experiments/modal-reliability/analyze-recording.mjs <recording.mp4> [--regions file.json] [--output directory] [--setup] [--configuration label]');
        return;
    }
    const video = path.resolve(args.shift()), options = {};
    while (args.length) {
        const key = args.shift();
        if (key === '--setup') options.setup = true;
        else if (['--regions', '--output', '--configuration'].includes(key) && args.length)
            options[{ '--regions': 'configPath', '--output': 'output', '--configuration': 'configuration' }[key]] = args.shift();
        else throw Error(`Unknown or incomplete option: ${key}`);
    }
    const report = await analyzeRecording(video, options);
    if (report.calibrationRequired) { console.log(report.instructions); process.exitCode = 2; return; }
    console.log(resultRow(report));
    for (const event of report.events) console.log(`Frame ${event.frame}: ${event.timestamp.toFixed(6)} s, ${(event.sourceDuration * 1000).toFixed(3)} ms, immediate return: ${event.immediateReappearance}`);
    console.log(`Captured rate ${report.capture.effectiveFps?.toFixed(3) ?? 'unknown'} fps; maximum gap ${(report.capture.maximumInterFrameGap * 1000).toFixed(3)} ms.`);
    if (!report.capture.sufficientFor8ms) console.log('WARNING: Insufficient capture coverage to exclude an approximately 8 ms event.');
    console.log(`Report: ${options.output || video + '.analysis'}/report.md`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
    main(process.argv.slice(2)).catch(error => { console.error(`Analysis failed: ${error.message}`); process.exitCode = 1; });
