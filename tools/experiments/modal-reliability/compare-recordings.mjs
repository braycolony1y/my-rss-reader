import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export function combineRecordingResults(reports) {
    const groups = new Map();
    for (const report of reports) {
        if (!Number.isFinite(report.capture?.observedDuration) || report.capture.observedDuration <= 0
            || !report.capture.finalDurationKnown || !Array.isArray(report.events))
            throw Error('Input is not a successful recording analysis');
        const key = report.configuration, layout = JSON.stringify([report.sourceStream?.width, report.sourceStream?.height, report.calibration?.regions]);
        const row = groups.get(key) || { configuration: key, layout, runs: 0, duration: 0, frames: 0, maximumGap: 0, dropouts: 0, adequate8ms: true };
        if (row.layout !== layout) throw Error(`Different calibrated layouts grouped as ${key}; use separate configuration labels`);
        row.runs++; row.duration += report.capture.observedDuration; row.frames += report.capture.frames;
        row.maximumGap = Math.max(row.maximumGap, report.capture.maximumInterFrameGap);
        row.dropouts += report.events.length; row.adequate8ms &&= report.capture.sufficientFor8ms;
        groups.set(key, row);
    }
    return [...groups.values()].map(row => ({ ...row, ratePerMinute: row.dropouts * 60 / row.duration }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        const files = process.argv.slice(2);
        if (!files.length) throw Error('Pass one or more recording .analysis/summary.json files');
        const rows = combineRecordingResults(await Promise.all(files.map(async file => JSON.parse(await readFile(file, 'utf8')))));
        console.log('| Configuration | Runs | Duration | Captured frames | Maximum gap | Dropouts | Rate/min |');
        console.log('| --- | --- | --- | --- | --- | --- | --- |');
        for (const r of rows) console.log(`| ${String(r.configuration).replaceAll('|', '\\|')} | ${r.runs} | ${r.duration.toFixed(3)} s | ${r.frames} | ${(r.maximumGap * 1000).toFixed(3)} ms | ${r.dropouts} | ${r.ratePerMinute.toFixed(3)} |`);
        console.log('\nRates are observed counts divided by recorded exposure, not extrapolations from the original clip.');
        if (rows.some(r => !r.adequate8ms)) console.log('WARNING: At least one capture has insufficient coverage to exclude an approximately 8 ms event.');
        console.log('Chrome/GPU state, workload, instrumentation, and external capture settings must be checked in the run notes; video metrics cannot establish comparability.');
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
