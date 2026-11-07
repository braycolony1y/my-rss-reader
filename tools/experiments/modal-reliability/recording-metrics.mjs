import { pixelDistance } from './usage-frames.mjs';

export function captureMetrics(frames) {
    if (!frames.length) throw Error('No source timing');
    const gaps = frames.slice(1).map((f, i) => f.time - frames[i].time);
    const durations = frames.map(f => f.duration).filter(d => d !== null).sort((a, b) => a - b);
    const histogram = {};
    for (const d of durations) { const key = (d * 1000).toFixed(3); histogram[key] = (histogram[key] || 0) + 1; }
    const last = frames.at(-1), observedDuration = last.time - frames[0].time + (last.duration || 0);
    const quantile = p => durations.length ? durations[Math.floor((durations.length - 1) * p)] : null;
    const maxGap = gaps.reduce((max, value) => Math.max(max, value), 0);
    const missingDurations = frames.length - durations.length;
    return { frames: frames.length, observedDuration, finalDurationKnown: last.duration !== null,
        observedDurationIsLowerBound: last.duration === null,
        effectiveFps: observedDuration > 0 ? frames.length / observedDuration : null,
        maximumInterFrameGap: maxGap, missingDurations,
        frameDurations: { min: durations[0] ?? null, median: quantile(.5), p95: quantile(.95),
            p99: quantile(.99), max: durations.at(-1) ?? null, histogramMilliseconds: histogram },
        sufficientFor8ms: !missingDurations && frames.length > 1 && maxGap <= .008 && durations.at(-1) <= .008,
        warning: 'Capture statistics describe recorded samples, not guaranteed displayed-frame coverage. Missing a short displayed event is possible even at a nominal 120 fps.' };
}

export function scoreVisibleRegions(pixels, reference, regions) {
    return pixels.map((p, i) => ({ name: regions[i].name, role: regions[i].role,
        difference: pixelDistance(p, reference[i]), threshold: regions[i].threshold ?? (regions[i].role === 'backdrop' ? 3 : 12) }));
}

// A transient must affect every calibrated foreground/backdrop region and be
// bracketed by the original foreground. Persistent opening/closing is reported
// separately. Pixels alone cannot tell a CSS hide from a compositor failure.
export function detectDropouts(frames, scores, { maxTransientSeconds = .1 } = {}) {
    const changed = scores.map(row => row.every(s => s.difference > s.threshold));
    const stable = scores.map(row => row.every(s => s.difference < s.threshold * .5));
    const events = [], unclassifiedChanges = [];
    for (let start = 0; start < changed.length; start++) {
        if (!changed[start]) continue;
        let end = start;
        while (end + 1 < changed.length && changed[end + 1]) end++;
        // Presentation persists until the return frame, even when packet
        // duration metadata understates that span in a VFR recording.
        const sourceEnd = frames[end + 1]?.time ?? (frames[end].time + (frames[end].duration || 0));
        const duration = sourceEnd - frames[start].time;
        const bracketed = start > 0 && end + 1 < frames.length && stable[start - 1] && stable[end + 1];
        const event = { frame: start, lastFrame: end, timestamp: frames[start].time,
            sourceDuration: frames[start].duration, duration, presentationSpan: duration, frameCount: end - start + 1,
            immediateReappearance: end === start && bracketed, previousFrame: start - 1, returnFrame: end + 1 };
        const knownDurations = frames.slice(start, end + 1).every(frame => frame.duration !== null);
        if (bracketed && duration > 0 && duration <= maxTransientSeconds && knownDurations) events.push(event);
        else unclassifiedChanges.push({ ...event, reason: !bracketed ? 'No stable visible frame on both sides' : 'Duration unknown or exceeds transient window' });
        start = end;
    }
    return { events, unclassifiedChanges, intervalsBetweenEvents: events.slice(1).map((e, i) => e.timestamp - events[i].timestamp) };
}

export function resultRow(report) {
    const m = report.capture;
    const rate = Number.isFinite(report.ratePerMinute) ? report.ratePerMinute.toFixed(3) : 'unknown';
    return `| ${report.configuration} | ${m.observedDurationIsLowerBound ? 'at least ' : ''}${m.observedDuration.toFixed(3)} s | ${m.frames} | ${(m.maximumInterFrameGap * 1000).toFixed(3)} ms | ${report.events.length} | ${rate} |`;
}
