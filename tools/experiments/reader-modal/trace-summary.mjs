// Summarize Chromium's reported compositor stages; these intervals are not
// measurements of physical display presentation or exclusively GPU execution.
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import path from 'node:path';

const stageNames = new Set([
    'SubmitCompositorFrameToPresentationCompositorFrame',
    'SubmitToReceiveCompositorFrame',
    'ReceiveCompositorFrameToStartDraw',
    'StartDrawToSwapStart',
    'SwapEndToPresentationCompositorFrame'
]);

export function summarizeCompositorStages(events) {
    const pending = new Map();
    const samples = new Map();
    for (const event of events) {
        if (!stageNames.has(event.name)) continue;
        const key = JSON.stringify([event.name, event.pid, event.id2 || event.id]);
        if (event.ph === 'b') pending.set(key, event.ts);
        else if (event.ph === 'e' && pending.has(key)) {
            const duration = (event.ts - pending.get(key)) / 1000;
            pending.delete(key);
            if (duration < 0) continue;
            if (!samples.has(event.name)) samples.set(event.name, []);
            samples.get(event.name).push(duration);
        }
    }
    return [...samples].map(([stage, durations]) => {
        durations.sort((a, b) => a - b);
        return {
            stage,
            count: durations.length,
            meanMs: durations.reduce((sum, value) => sum + value, 0) / durations.length,
            p95Ms: durations[Math.ceil(durations.length * 0.95) - 1],
            maxMs: durations.at(-1)
        };
    });
}

export function summarizeSoftwareDrawing(events) {
    const process = events.find(event => event.name === 'process_name'
        && event.args?.name === 'GPU Process')?.pid;
    const samples = new Map();
    for (const event of events) {
        if (event.pid !== process || event.ph !== 'X') continue;
        if (!['DirectRenderer::DrawFrame', 'DirectRenderer::DrawRenderPass',
            'SoftwareRenderer::DoDrawQuad', 'SoftwareRenderer::SwapBuffers'].includes(event.name)
            && !event.name.startsWith('void SkCanvas::drawImage(')) continue;
        if (!samples.has(event.name)) samples.set(event.name, []);
        samples.get(event.name).push(event);
    }
    return [...samples].map(([operation, entries]) => {
        const durations = entries.map(event => event.dur / 1000).sort((a, b) => a - b);
        return {
            operation,
            count: entries.length,
            // Nested operations overlap: these totals must not be added.
            inclusiveWallMs: durations.reduce((sum, value) => sum + value, 0),
            inclusiveThreadMs: entries.reduce((sum, event) => sum + (event.tdur || 0) / 1000, 0),
            meanWallMs: durations.reduce((sum, value) => sum + value, 0) / durations.length,
            p95WallMs: durations[Math.ceil(durations.length * 0.95) - 1],
            maxWallMs: durations.at(-1)
        };
    });
}

const results = [];
for (const file of process.argv.slice(2)) {
    const bytes = await readFile(file);
    const trace = JSON.parse(file.endsWith('.gz') ? gunzipSync(bytes) : bytes);
    results.push({trace: path.basename(file), stages: summarizeCompositorStages(trace.traceEvents),
        softwareDrawing: summarizeSoftwareDrawing(trace.traceEvents)});
}
console.log(JSON.stringify(results, null, 2));
